"""Snapshot orchestration (M1: Zerodha end-to-end via the local daemon).

One run per platform. The write pattern is deliberately split by kind so that
repeated polling never fills the DB with junk:

  position (live state)          upserted IN PLACE every poll - the table does
                                 not grow no matter how often we poll (the v1 flaw:
                                 32 polls x holdings = 1,120 near-identical rows).
  position_snapshot, price_history, portfolio_value
                                 written ONLY on EOD runs - the daily ledger
                                 that makes YoY / day-on-day returns possible.
  runs                           one row per poll attempt (audit + lineage).

Live prices for the UI are fetched on demand over MCP (Refresh-now) and update
`position` in place; they are not stored as ticks (design decision: live-fetch
only, store EOD).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from portfolio.alerts.telegram import send_snapshot_expiry_warning
from portfolio.config import DB_PATH, Settings
from portfolio.db import connect, writer
from portfolio.fx import get_fx_rate
from portfolio.normalize.zerodha import normalize_holdings
from portfolio.serve import DEFAULT_PORT

logger = logging.getLogger("portfolio.snapshot")


class SessionNotReady(Exception):
    """The broker session is not available (daemon down or unauthenticated)."""


def run_snapshot(platform: str, is_eod: bool = False, db_path: Path | None = None) -> str:
    if platform not in ("zerodha", "groww", "moomoo", "all"):
        raise ValueError(f"unknown platform: {platform!r}")
    if platform == "all":
        raise NotImplementedError("M2 adds consolidated --all; build per-platform first.")
    return _snapshot_zerodha(is_eod=is_eod, db_path=db_path or DB_PATH)


def _snapshot_zerodha(*, is_eod: bool, port: int = DEFAULT_PORT, db_path: Path = DB_PATH) -> str:
    now = datetime.now(UTC)
    run_at = now.isoformat()
    snapshot_date = now.astimezone().date().isoformat()  # local market date
    db = _db_connection(db_path)

    try:
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

        holdings = normalize_holdings(payload, sectors=_load_sectors())
        base = Settings().base_currency

        run_id = writer.write_run(db, "zerodha", snapshot_date, run_at, "running", is_eod=is_eod)
        _persist(db, run_id, run_at, holdings, snapshot_date, base, is_eod)
        writer.update_run(db, run_id, "ok", len(holdings))
        return f"ok: {len(holdings)} holdings"
    except SessionNotReady:
        raise
    finally:
        db.close()


# ---- persistence -----------------------------------------------------------


def _persist(
    db: Any, run_id: int, run_at: str, holdings: list[Any], snapshot_date: str, base: str, is_eod: bool
) -> None:
    """Write one run of holdings: live position always, history only on EOD."""
    if not holdings:
        return
    platform = holdings[0].platform
    account_id = writer.ensure_account(db, platform)
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

        writer.upsert_position(
            db, account_id, instrument_id,
            quantity=rec["quantity"], avg_cost=rec["avg_price"], price=rec["current_price"],
            cost_value_ccy=rec["cost_basis"], market_value_ccy=rec["current_value"],
            market_value_base=value_base, updated_at=run_at,
        )
        if is_eod:
            writer.upsert_position_snapshot(
                db, run_id, account_id, instrument_id, fx_rate_id, snapshot_date,
                quantity=rec["quantity"], avg_cost=rec["avg_price"], price=rec["current_price"],
                cost_value_ccy=rec["cost_basis"], market_value_ccy=rec["current_value"],
                market_value_base=value_base,
            )
            writer.upsert_price(db, instrument_id, snapshot_date, rec["current_price"], rec["currency"])

    if is_eod:
        for scope_type, scope_key, value_base in _portfolio_values(holdings, base):
            writer.upsert_portfolio_value(db, snapshot_date, is_eod, scope_type, scope_key, value_base)


def _fx_for(
    db: Any, snapshot_date: str, base: str, currency: str,
    settings: Settings, cache: dict[str, tuple[float, int | None]],
) -> tuple[float, int | None]:
    """One rate per run per currency (M2 fetches it; M1 is INR-only = 1.0)."""
    if currency in cache:
        return cache[currency]
    rate = get_fx_rate(base, currency)
    fx_id = writer.ensure_fx_rate(
        db, snapshot_date, base, currency, settings.fx_source, rate, datetime.now(UTC).isoformat()
    )
    cache[currency] = (rate, fx_id)
    return cache[currency]


def _portfolio_values(holdings: list[Any], base: str) -> list[tuple[str, str, float]]:
    """Total portfolio value in base, per scope (all / geography / platform)."""
    totals: dict[tuple[str, str], float] = {}
    for h in holdings:
        rec = h.as_record()
        value = rec["current_value"] * get_fx_rate(base, rec["currency"])
        for scope in (("all", ""), ("geography", rec["geography"]), ("platform", rec["platform"])):
            totals[scope] = totals.get(scope, 0.0) + value
    return [(scope_type, scope_key, total) for (scope_type, scope_key), total in totals.items()]


# ---- daemon RPC ----------------------------------------------------------


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
