"""Snapshot orchestration (M1: Zerodha via daemon; M2: Moomoo direct OAuth).

One run per platform. The write pattern is deliberately split by kind so that
repeated polling never fills the DB with junk:

  position (live state)          upserted IN PLACE every poll - the table does
                                 not grow no matter how often we poll (the v1 flaw:
                                 32 polls x holdings = 1,120 near-identical rows).
  position_snapshot, price_history, portfolio_value
                                 written ONLY on EOD runs - the daily ledger
                                 that makes YoY / day-on-day returns possible.
  runs                           one row per poll attempt (audit + lineage).

`--platform all` (M2) runs the legs sequentially and then writes ONE consolidated
portfolio_value set (scope all/geography/platform) across every holding, so the
`all` scope is never clobbered by a later leg (UNIQUE(value_date, is_eod,
scope_type, scope_key) upsert). The consolidated INR-base allocation is computed
with the same one-rate-per-run FX table the legs used (process-wide cache in
portfolio.fx), so position rows and the allocation always reconcile.

Live prices for the UI are fetched on demand over MCP (Refresh-now) and update
`position` in place; they are not stored as ticks (design decision: live-fetch
only, store EOD).
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from portfolio.alerts.telegram import send_snapshot_expiry_warning
from portfolio.config import (
    DATA_DIR,
    DB_PATH,
    PLATFORMS,
    ROOT_DIR,
    Settings,
    platform_display_currency,
)
from portfolio.db import connect, writer
from portfolio.fx import FXError, get_fx_rate, get_fx_rates
from portfolio.normalize.allocation import DIMENSIONS, compute_allocation
from portfolio.normalize.moomoo import normalize_holdings as normalize_moomoo
from portfolio.normalize.schema import Holding
from portfolio.normalize.zerodha import normalize_holdings as normalize_zerodha
from portfolio.serve import DEFAULT_PORT

logger = logging.getLogger("portfolio.snapshot")

LEGS = ("zerodha", "moomoo")  # groww lands in M3


class SessionNotReady(Exception):
    """The broker session is not available (daemon down or unauthenticated)."""


@dataclass
class LegResult:
    summary: str
    holdings: list[Holding] = field(default_factory=list)


def run_snapshot(platform: str, is_eod: bool = False, db_path: Path | None = None) -> str:
    if platform not in ("zerodha", "groww", "moomoo", "all"):
        raise ValueError(f"unknown platform: {platform!r}")
    if platform == "all":
        return _snapshot_all(is_eod=is_eod, db_path=db_path or DB_PATH)
    if platform == "groww":
        raise NotImplementedError("M3 adds Groww via its custom FastMCP wrapper.")
    if platform == "zerodha":
        return _snapshot_zerodha(is_eod=is_eod, db_path=db_path or DB_PATH).summary
    return _snapshot_moomoo(is_eod=is_eod, db_path=db_path or DB_PATH).summary


def _snapshot_all(*, is_eod: bool, db_path: Path) -> str:
    """Run every platform leg, then persist ONE consolidated value set + allocation."""
    results: list[str] = []
    errors: list[str] = []
    all_holdings: list[Holding] = []

    for leg in LEGS:
        try:
            if leg == "zerodha":
                res = _snapshot_zerodha(is_eod=is_eod, db_path=db_path, write_values=False)
            else:
                res = _snapshot_moomoo(is_eod=is_eod, db_path=db_path, write_values=False)
            results.append(f"{leg}: {res.summary}")
            all_holdings.extend(res.holdings)
        except SessionNotReady as exc:
            errors.append(f"{leg}: {exc}")

    if not all_holdings:
        detail = "; ".join(errors) if errors else "no holdings from any platform"
        raise SessionNotReady(f"snapshot --all produced no data ({detail})")

    base = Settings().base_currency
    db = _db_connection(db_path)
    try:
        currencies = sorted({h.currency for h in all_holdings})
        # One rate per run: get_fx_rates uses the same process cache the legs
        # populated, so no second fetch and identical rates (determinism).
        rates = get_fx_rates(base, currencies)
        rates[base] = 1.0
        alloc = compute_allocation(all_holdings, rates, base=base)
        if is_eod:
            snapshot_date = datetime.now(UTC).astimezone().date().isoformat()
            for scope_type, scope_key, value in _portfolio_values(all_holdings, base):
                writer.upsert_portfolio_value(db, snapshot_date, True, scope_type, scope_key, value)
        share_lines = [
            f"{dim}: " + ", ".join(f"{k}={v:.1f}%" for k, v in alloc.shares(dim).items())
            for dim in DIMENSIONS
        ]
        parts = [f"total={alloc.total_base:,.2f} {base}", *results]
        if errors:
            parts.append("FAILED: " + "; ".join(errors))
        if alloc.total_base:
            parts.extend(share_lines)
        return " | ".join(parts)
    finally:
        db.close()


# ---- per-platform legs ------------------------------------------------------


def _snapshot_zerodha(
    *, is_eod: bool, port: int = DEFAULT_PORT, db_path: Path = DB_PATH, write_values: bool = True
) -> LegResult:
    now = datetime.now(UTC)
    run_at = now.isoformat()
    snapshot_date = now.astimezone().date().isoformat()  # local market date
    db = _db_connection(db_path)

    try:
        ensure_zerodha_daemon()
        raw = _fetch(port, "get_holdings", {})
        if raw.get("login_required"):
            send_snapshot_expiry_warning("zerodha", "session expired", settings=Settings())
            writer.write_run(db, "zerodha", snapshot_date, run_at, "error", error="session expired", is_eod=is_eod)
            raise SessionNotReady("Zerodha session expired - run `portfolio serve --platform zerodha` to re-login")

        payload = raw.get("parse", [])
        if not isinstance(payload, list):
            writer.write_run(
                db, "zerodha", snapshot_date, run_at, "error",
                error=f"unexpected holdings shape: {type(payload)!r}", is_eod=is_eod,
            )
            raise SessionNotReady(f"unexpected holdings payload: {type(payload).__name__}")

        holdings = normalize_zerodha(payload, sectors=_load_sectors())
        base = Settings().base_currency
        run_id = writer.write_run(db, "zerodha", snapshot_date, run_at, "running", is_eod=is_eod)
        try:
            _persist(db, run_id, run_at, holdings, snapshot_date, base, is_eod, write_values=write_values)
        except FXError as exc:
            writer.update_run(db, run_id, "error", 0, error=str(exc))
            raise SessionNotReady(f"zerodha snapshot failed: {exc}") from exc
        writer.update_run(db, run_id, "ok", len(holdings))
        return LegResult(f"ok: {len(holdings)} holdings", holdings)
    except SessionNotReady:
        raise
    finally:
        db.close()


def _snapshot_moomoo(*, is_eod: bool, db_path: Path = DB_PATH, write_values: bool = True) -> LegResult:
    now = datetime.now(UTC)
    run_at = now.isoformat()
    snapshot_date = now.astimezone().date().isoformat()
    db = _db_connection(db_path)

    try:
        holdings, acc_id = asyncio.run(_collect_moomoo())
        base = Settings().base_currency
        run_id = writer.write_run(db, "moomoo", snapshot_date, run_at, "running", is_eod=is_eod)
        try:
            _persist(
                db, run_id, run_at, holdings, snapshot_date, base, is_eod,
                write_values=write_values, account_ref=acc_id or "",
            )
        except FXError as exc:
            writer.update_run(db, run_id, "error", 0, error=str(exc))
            raise SessionNotReady(f"moomoo snapshot failed: {exc}") from exc
        writer.update_run(db, run_id, "ok", len(holdings))
        return LegResult(f"ok: {len(holdings)} holdings", holdings)
    except SessionNotReady:
        raise
    finally:
        db.close()


async def _collect_moomoo() -> tuple[list[Holding], str | None]:
    """One wrapper connection (OpenD-backed): accounts -> positions -> holdings.

    The local moomoo_mcp server is spawned per run; OpenD holds the session.
    If OpenD is down or the trade password is wrong, we surface a Telegram
    warning (the fix is manual: open OpenD and log in) instead of failing
    silently.
    """
    from portfolio.clients.moomoo import MoomooMCPClient

    try:
        async with MoomooMCPClient() as client:
            acc_res = await client.call("get_accounts")
            if acc_res.is_error:
                raise SessionNotReady(f"moomoo accounts call failed: {acc_res.raw[:200]}")
            acc_id = _pick_real_account(acc_res.json())
            if acc_id is None:
                raise SessionNotReady("no REAL moomoo trading account found in get_accounts")
            pos_res = await client.call("get_positions", {"trd_env": "REAL", "acc_id": acc_id})
            if pos_res.is_error:
                raise SessionNotReady(f"moomoo positions call failed: {pos_res.raw[:200]}")
            payload = pos_res.json()
            if payload is None:
                raise SessionNotReady("moomoo positions returned no parseable payload")
            holdings = normalize_moomoo(payload, sectors=_load_sectors())
            return holdings, acc_id
    except SessionNotReady:
        raise
    except Exception as exc:  # noqa: BLE001 - OpenD down / transport error
        send_snapshot_expiry_warning(
            "moomoo", f"cannot read holdings: {exc}",
            action="open the OpenD gateway app and log in (download: moomoo.com/download/opend); "
            "if that fails, re-run `portfolio auth --platform moomoo` to refresh the trade password.",
        )
        raise SessionNotReady(f"Moomoo holdings unavailable - is OpenD running? ({exc})") from exc


def _pick_real_account(payload: Any) -> str | None:
    """Find the REAL (non-simulated) trading account id in the MCP payload.

    The moomoo wrapper returns {"accounts": [...]}; each record carries trd_env
    ('REAL'/'SIMULATE'); acc_type is the account kind ('MARGIN'/'CASH') and must
    NOT shadow it.
    """
    if isinstance(payload, dict):
        payload = payload.get("accounts") or payload.get("data") or payload
    items = payload if isinstance(payload, list) else [payload]
    for item in items:
        if not isinstance(item, dict):
            continue
        env = str(item.get("trd_env") or item.get("account_type") or "").upper()
        acc_id = item.get("acc_id") or item.get("account_id")
        if acc_id and (env == "REAL" or not env):
            return str(acc_id)
    return None


# ---- persistence -----------------------------------------------------------


def _persist(
    db: Any, run_id: int, run_at: str, holdings: list[Holding], snapshot_date: str,
    base: str, is_eod: bool, *, write_values: bool = True, account_ref: str = "",
) -> None:
    """Write one run of holdings: live position always, history only on EOD."""
    if not holdings:
        return
    platform = holdings[0].platform
    account_id = writer.ensure_account(
        db, platform, account_ref=account_ref,
        base_currency=platform_display_currency(platform),
    )
    settings = Settings()
    fx_cache: dict[str, tuple[float, int | None]] = {}

    for h in holdings:
        rec = h.as_record()
        instrument_id = writer.ensure_instrument(
            db, rec["platform"], rec["ticker"],
            name=rec["name"], geography=rec["geography"], currency=rec["currency"],
            sector=rec["sector"], asset_class=rec["asset_class"],
        )
        rate, fx_rate_id = _fx_for(db, snapshot_date, base, rec["currency"], settings, fx_cache)
        value_base = rec["current_value"] * rate
        cost_base = rec["cost_basis"] * rate if rec["cost_basis"] is not None else None

        writer.upsert_position(
            db, account_id, instrument_id,
            quantity=rec["quantity"], avg_cost=rec["avg_price"], price=rec["current_price"],
            cost_value_ccy=rec["cost_basis"], market_value_ccy=rec["current_value"],
            market_value_base=value_base, cost_value_base=cost_base, updated_at=run_at,
        )
        if is_eod:
            writer.upsert_position_snapshot(
                db, run_id, account_id, instrument_id, fx_rate_id, snapshot_date,
                quantity=rec["quantity"], avg_cost=rec["avg_price"], price=rec["current_price"],
                cost_value_ccy=rec["cost_basis"], market_value_ccy=rec["current_value"],
                market_value_base=value_base, cost_value_base=cost_base,
            )
            writer.upsert_price(db, instrument_id, snapshot_date, rec["current_price"], rec["currency"])

    # The dashboard shows the account leg in its display currency (moomoo -> SGD),
    # so persist those rates too - they come from the SAME er-api fetch (cached).
    _ensure_display_rates(db, snapshot_date, base, settings)

    if is_eod and write_values:
        for scope_type, scope_key, value_base in _portfolio_values(holdings, base):
            writer.upsert_portfolio_value(db, snapshot_date, is_eod, scope_type, scope_key, value_base)


def _ensure_display_rates(
    db: Any, snapshot_date: str, base: str, settings: Settings,
) -> None:
    """Persist fx rates for every account display currency that is not the base.

    The one-rate-per-run fetch already downloaded the whole table; this just
    stores the rows the dashboard needs (e.g. INR/SGD for the Moomoo leg).
    """
    for meta in PLATFORMS.values():
        display = meta["display_currency"]
        if display == base:
            continue
        rate = get_fx_rate(base, display)  # process-wide cache: no second fetch
        writer.ensure_fx_rate(
            db, snapshot_date, base, display, settings.fx_source, rate, datetime.now(UTC).isoformat()
        )


def _fx_for(
    db: Any, snapshot_date: str, base: str, currency: str,
    settings: Settings, cache: dict[str, tuple[float, int | None]],
) -> tuple[float, int | None]:
    """One rate per run per currency (M2 fetches it; identity pairs return 1.0)."""
    if currency in cache:
        return cache[currency]
    rate = get_fx_rate(base, currency)
    fx_id = writer.ensure_fx_rate(
        db, snapshot_date, base, currency, settings.fx_source, rate, datetime.now(UTC).isoformat()
    )
    cache[currency] = (rate, fx_id)
    return cache[currency]


def _portfolio_values(holdings: list[Holding], base: str) -> list[tuple[str, str, float]]:
    """Total portfolio value in base, per scope (all / geography / platform)."""
    totals: dict[tuple[str, str], float] = {}
    for h in holdings:
        rec = h.as_record()
        value = rec["current_value"] * get_fx_rate(base, rec["currency"])
        for scope in (("all", ""), ("geography", rec["geography"]), ("platform", rec["platform"])):
            totals[scope] = totals.get(scope, 0.0) + value
    return [(scope_type, scope_key, total) for (scope_type, scope_key), total in totals.items()]


# ---- daemon RPC ----------------------------------------------------------


# serve.py waits up to 300s for the daily browser login; give the health poll
# a little headroom so a successful login is never raced.
DAEMON_START_TIMEOUT_SECONDS = 330.0
DAEMON_LOG = DATA_DIR / "logs" / "zerodha_serve.log"


def daemon_health() -> dict[str, Any] | None:
    """GET /health from the Zerodha session daemon; None if unreachable."""
    try:
        resp = httpx.get(f"http://127.0.0.1:{DEFAULT_PORT}/health", timeout=3)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError:
        return None


def ensure_zerodha_daemon(*, wait_seconds: float = DAEMON_START_TIMEOUT_SECONDS) -> None:
    """Make sure the Zerodha session daemon is up; spawn it if not.

    Scheduled runs (M4) find the daemon already started by Task Scheduler, so
    this returns instantly. On a manual `snapshot --all` with the daemon down,
    we spawn it in the background: it connects to Kite and, if no session
    exists, opens the browser for the daily MANUAL 2FA login - serve.py blocks
    until the login completes (or 300s), and only then starts serving, so this
    health poll IS the login wait. Complete the 2FA in the browser and the
    snapshot proceeds by itself.

    Set PORTFOLIO_NO_DAEMON=1 to skip auto-launch (daemon managed elsewhere).
    """
    if os.environ.get("PORTFOLIO_NO_DAEMON"):
        return
    health = daemon_health()
    if health and health.get("ok"):
        # Daemon up. Auth status is the leg's job (login_required -> warning).
        return
    if not health:
        _spawn_zerodha_daemon()
    print(
        "Zerodha daemon is not running - starting it. If a browser login window "
        f"opens, complete the 2FA login (waiting up to {int(wait_seconds)}s)."
    )
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        time.sleep(3)
        health = daemon_health()
        if health and health.get("ok"):
            logger.info("zerodha daemon up after spawn")
            return
    raise SessionNotReady(
        "zerodha daemon did not come up in time - check data/logs/zerodha_serve.log "
        "(a manual browser 2FA login is required)."
    )


def _spawn_zerodha_daemon() -> None:
    """Detach `portfolio serve --platform zerodha` with output to a log file."""
    DAEMON_LOG.parent.mkdir(parents=True, exist_ok=True)
    flags = 0
    if os.name == "nt":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    with open(DAEMON_LOG, "ab") as fh:
        subprocess.Popen(
            [sys.executable, "-m", "portfolio.cli", "serve", "--platform", "zerodha"],
            cwd=str(ROOT_DIR),
            stdout=fh,
            stderr=subprocess.STDOUT,
            creationflags=flags,
            close_fds=True,
        )
    logger.info("spawned zerodha daemon (log: %s)", DAEMON_LOG)


def _fetch(port: int, tool: str, args: dict[str, Any]) -> dict[str, Any]:
    try:
        resp = httpx.post(f"http://127.0.0.1:{port}/rpc", json={"tool": tool, "args": args}, timeout=30)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as exc:
        raise SessionNotReady(
            f"cannot reach zerodha daemon on :{port} - start it with `portfolio serve --platform zerodha` ({exc})"
        ) from exc
    _attach_parsed(data)
    return data


def _attach_parsed(data: dict[str, Any]) -> None:
    """Best-effort JSON parse of the daemon's text payload into `parse`."""

    def _try_parse(text: Any) -> Any:
        import json

        if not isinstance(text, str):
            return None
        try:
            return json.loads(text)
        except (json.JSONDecodeError, TypeError):
            return None

    parsed = None
    for text in data.get("texts", []):
        parsed = _try_parse(text)
        if parsed is not None:
            break
    data["parse"] = parsed


def _load_sectors() -> dict[str, tuple[str | None, str | None]]:
    """Load data/sectors.csv {ticker -> (sector, asset_class)} if present."""
    csv_path = Path(__file__).parent.parent.parent / "data" / "sectors.csv"
    if not csv_path.exists():
        return {}
    import csv as _csv

    lookup: dict[str, tuple[str | None, str | None]] = {}
    with csv_path.open(newline="", encoding="utf-8") as fh:
        for row in _csv.DictReader(fh):
            ticker = (row.get("ticker") or "").strip()
            if ticker:
                lookup[ticker] = (row.get("sector") or None, row.get("asset_class") or None)
    return lookup


def _db_connection(db_path: Path):
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return connect(path)
