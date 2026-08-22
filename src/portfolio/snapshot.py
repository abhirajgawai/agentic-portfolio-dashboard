"""Snapshot orchestration (M1: Zerodha via daemon; M2: Moomoo via OpenD wrapper).

One run per platform. The write pattern is deliberately split by kind so that
repeated polling never fills the DB with junk:

  position (live state)          upserted IN PLACE every poll - the table does
                                 not grow no matter how often we poll (the v1 flaw:
                                 32 polls x holdings = 1,120 near-identical rows).
  position_snapshot, price_history
                                 written ONLY on EOD runs - the daily ledger
                                 that makes YoY / day-on-day returns possible.
  runs                           one row per poll attempt (audit + lineage).

`--platform all` (M2) runs the legs sequentially, then computes ONE consolidated
INR-base allocation across every holding with the same one-rate-per-run FX table
the legs used (process-wide cache in portfolio.fx), so position rows and the
allocation always reconcile.

The dashboard's value HISTORY is DERIVED from position_snapshot by
portfolio.series at export time. The legacy portfolio_value write path was
removed (F1): per-leg writes could never sum honestly across mixed-frequency
legs (M-3 live proof: 2026-08-07 `all` = 3,829,419 excluded the whole CAS leg;
the true total was 6,638,591). The table and its historical rows remain, unread.

Live prices for the UI are fetched on demand over MCP (Refresh-now) and update
`position` in place; they are not stored as ticks (design decision: live-fetch
only, store EOD).

M-2 audit contract: every failure mode of a leg (shape drift, normalize error,
session expiry, persist error) writes a `runs` row (status='error') and surfaces
as SessionNotReady - never a raw traceback, and `--all` continues past a failed
leg so one broker cannot kill the others.
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
from zoneinfo import ZoneInfo

import httpx

from portfolio.alerts.telegram import send_snapshot_expiry_warning
from portfolio.calendars import gate_check
from portfolio.config import (
    DATA_DIR,
    DB_PATH,
    ROOT_DIR,
    Settings,
    platform_geography,
)
from portfolio.db import connect, writer
from portfolio.db.persist import persist
from portfolio.fx import get_fx_rates
from portfolio.normalize.allocation import DIMENSIONS, compute_allocation
from portfolio.normalize.moomoo import normalize_holdings as normalize_moomoo
from portfolio.normalize.schema import Holding
from portfolio.normalize.sectors import load_names, load_sectors
from portfolio.normalize.zerodha import normalize_holdings as normalize_zerodha
from portfolio.serve import DEFAULT_PORT

logger = logging.getLogger("portfolio.snapshot")

LEGS = ("zerodha", "moomoo")

# Asia/Kolkata is the ledger's market-date timezone - NEVER machine-local
# (NIT-2): a snapshot must record the same date on any host.
_IST = ZoneInfo("Asia/Kolkata")


class SessionNotReady(Exception):
    """The broker session is not available (daemon down or unauthenticated)."""


@dataclass
class LegResult:
    summary: str
    holdings: list[Holding] = field(default_factory=list)
    # Structural gate marker (MINOR-4): True for a calendar-skip leg. Kept on
    # the dataclass so `--all` can decide all-skipped WITHOUT parsing strings.
    skipped: bool = False


def run_snapshot(
    platform: str,
    is_eod: bool = False,
    db_path: Path | None = None,
    *,
    at: datetime | None = None,
    force: bool = False,
) -> str:
    """Run one platform's snapshot (or all), gated by the M4 calendar.

    `at` is the wall clock the calendar gate sees — injectable for tests and
    retried runs (determinism: the gate must never read the clock itself; the
    CLI is the caller and passes now(UTC)). `force` bypasses the gate.
    A gate skip is NOT a failure: the leg writes an audited `skipped` runs row
    and returns a skip summary instead of raising — a holiday must never touch
    a broker or fail a scheduled run (exit code stays 0).
    """
    if platform not in ("zerodha", "moomoo", "all"):
        raise ValueError(f"unknown platform: {platform!r}")
    at = at or datetime.now(UTC)
    if platform == "all":
        return _snapshot_all(is_eod=is_eod, db_path=db_path or DB_PATH, at=at, force=force)
    if platform == "zerodha":
        return _snapshot_zerodha(is_eod=is_eod, db_path=db_path or DB_PATH, at=at, force=force).summary
    return _snapshot_moomoo(is_eod=is_eod, db_path=db_path or DB_PATH, at=at, force=force).summary


def _snapshot_all(*, is_eod: bool, db_path: Path, at: datetime | None = None, force: bool = False) -> str:
    """Run every platform leg, then compute ONE consolidated allocation."""
    results: list[str] = []
    errors: list[str] = []
    leg_results: list[LegResult] = []
    all_holdings: list[Holding] = []

    for leg in LEGS:
        try:
            if leg == "zerodha":
                res = _snapshot_zerodha(is_eod=is_eod, db_path=db_path, at=at, force=force)
            else:
                res = _snapshot_moomoo(is_eod=is_eod, db_path=db_path, at=at, force=force)
            leg_results.append(res)
            results.append(f"{leg}: {res.summary}")
            all_holdings.extend(res.holdings)
        except Exception as exc:  # noqa: BLE001 - one bad leg must never kill the others
            errors.append(f"{leg}: {exc}")

    if not all_holdings:
        # M4 gate: every leg skipped by the calendar is NOT a failure — a
        # holiday/weekend is a normal no-op and the exit code must stay 0
        # (each skipped leg already wrote its own audited `runs` row). Only
        # real errors (or a genuinely empty run) surface as SessionNotReady.
        if not errors and leg_results and all(r.skipped for r in leg_results):
            return " | ".join(results) + " | all markets closed - nothing captured"
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


def _skip_leg(platform: str, reason: str, at: datetime, *, is_eod: bool, db_path: Path) -> LegResult:
    """M4 calendar gate skip: audited `skipped` runs row; no broker touched, no raise.

    A holiday is a normal no-op for a scheduled run — the row is the audit
    trail M4's "failures visible in runs" bar needs, and the exit code stays 0.
    snapshot_date is the MARKET date of the evaluated instant (`at`, injected
    by the caller); started_at is the per-attempt audit instant. Writes through
    the canonical writer.write_skipped (MINOR-5).
    """
    run_at = datetime.now(UTC).isoformat()
    snapshot_date = at.astimezone(_IST).date().isoformat()  # market date, never machine-local
    db = _db_connection(db_path)
    try:
        writer.write_skipped(db, platform, snapshot_date, run_at, reason, is_eod=is_eod)
    finally:
        db.close()
    return LegResult(f"skipped ({reason})", skipped=True)


def _session_expired(raw: dict[str, Any]) -> bool:
    """True when the daemon could not return holdings data.

    Three shapes mean the same thing - the daily 6 AM Kite token expired and the
    daemon needs a fresh browser login:
      1. `login_required` set by the daemon's ToolResult marker detection,
      2. an error text that mentions login,
      3. an errored RPC with no parseable payload (e.g. "Failed to execute
         get_holdings" when the connection's token is dead).
    """
    if raw.get("login_required"):
        return True
    if raw.get("parse") is not None:
        return False
    from portfolio.clients.base import LOGIN_REQUIRED_MARKERS

    haystack = " ".join(raw.get("texts") or []) + " " + str(raw.get("error") or "")
    low = haystack.lower()
    if any(m in low for m in LOGIN_REQUIRED_MARKERS):
        return True
    return bool(raw.get("is_error")) and raw.get("texts")


def _snapshot_zerodha(
    *,
    is_eod: bool,
    port: int = DEFAULT_PORT,
    db_path: Path = DB_PATH,
    at: datetime | None = None,
    force: bool = False,
) -> LegResult:
    at = at or datetime.now(UTC)
    # M4 gate FIRST: a holiday/weekend/closed-window must never spawn the
    # daemon or touch the broker - the skip is audited, not a failure.
    reason = gate_check(platform_geography("zerodha"), at, is_eod=is_eod)
    if reason and not force:
        return _skip_leg("zerodha", reason, at, is_eod=is_eod, db_path=db_path)
    # started_at is the per-attempt audit instant (runs.UNIQUE(platform,
    # started_at) - two polls at the same injected `at` are still two runs);
    # snapshot_date is the MARKET date of the evaluated instant (`at`).
    run_at = datetime.now(UTC).isoformat()
    snapshot_date = at.astimezone(_IST).date().isoformat()  # market date, never machine-local
    db = _db_connection(db_path)
    # F3: every failure mode must leave an audited `runs` row (M4's "failures
    # visible in runs" bar). The daemon/RPC section below raises BEFORE any
    # write_run exists, so its error row is written here - and this guard keeps
    # the inner paths (session-expired, shape check, normalize/persist wrapper)
    # from double-writing when they already logged their own row.
    run_written = False

    def _audit_failure(error: str) -> None:
        nonlocal run_written
        if not run_written:
            writer.write_run(db, "zerodha", snapshot_date, run_at, "error", error=error, is_eod=is_eod)
            run_written = True

    try:
        try:
            ensure_zerodha_daemon()
            raw = _fetch(port, "get_holdings", {})
        except SessionNotReady as exc:
            # Daemon down or RPC unreachable: audit, then surface - never vanish.
            _audit_failure(str(exc))
            raise
        if _session_expired(raw):
            send_snapshot_expiry_warning("zerodha", "session expired", settings=Settings())
            _audit_failure("session expired")
            raise SessionNotReady("Zerodha session expired - run `portfolio serve --platform zerodha` to re-login")

        payload = raw.get("parse", [])
        if not isinstance(payload, list):
            _audit_failure(f"unexpected holdings shape: {type(payload)!r}")
            raise SessionNotReady(f"unexpected holdings payload: {type(payload).__name__}")

        # M-2: shape drift is the pipeline's #1 risk (PLAN §7). A malformed row
        # must leave an audited `runs` error row and surface as SessionNotReady
        # - never a raw traceback that kills `--all`'s remaining legs.
        try:
            holdings = normalize_zerodha(payload, sectors=load_sectors(), names=load_names())
        except Exception as exc:  # noqa: BLE001 - audit, then re-raise
            _audit_failure(str(exc))
            raise SessionNotReady(f"zerodha snapshot failed: {exc}") from exc

        base = Settings().base_currency
        run_id = writer.write_run(db, "zerodha", snapshot_date, run_at, "running", is_eod=is_eod)
        run_written = True
        try:
            persist(db, run_id, run_at, holdings, snapshot_date, base, is_eod)
        except Exception as exc:  # noqa: BLE001 - audit-only; never fail un-audited
            writer.update_run(db, run_id, "error", 0, error=str(exc))
            raise SessionNotReady(f"zerodha snapshot failed: {exc}") from exc
        writer.update_run(db, run_id, "ok", len(holdings))
        if is_eod:
            # Daily trade + funds capture (best-effort; XIRR input). The same
            # injected `at` gates it inside capture_trades (trading-day policy).
            try:
                from portfolio.trades import capture_trades

                capture_trades("zerodha", db_path=db_path, port=port, at=at)
            except Exception:  # noqa: BLE001 - must never fail the holdings run
                logger.warning("zerodha trade/funds capture failed", exc_info=True)
        return LegResult(f"ok: {len(holdings)} holdings", holdings)
    except SessionNotReady:
        raise
    finally:
        db.close()


def _snapshot_moomoo(
    *,
    is_eod: bool,
    db_path: Path = DB_PATH,
    at: datetime | None = None,
    force: bool = False,
) -> LegResult:
    at = at or datetime.now(UTC)
    # M4 gate FIRST: a US holiday/weekend/closed-window must never touch the
    # OpenD gateway - the skip is audited, not a failure. The SAME `at` the
    # caller injected is converted to NY time by the gate.
    reason = gate_check(platform_geography("moomoo"), at, is_eod=is_eod)
    if reason and not force:
        return _skip_leg("moomoo", reason, at, is_eod=is_eod, db_path=db_path)
    # started_at is the per-attempt audit instant; snapshot_date is the MARKET
    # date of the evaluated instant (`at`).
    run_at = datetime.now(UTC).isoformat()
    snapshot_date = at.astimezone(_IST).date().isoformat()  # market date, never machine-local
    db = _db_connection(db_path)

    try:
        # Collection + normalize (M-2): any failure - shape drift, OpenD down,
        # account/position call errors - writes an audited `runs` error row and
        # surfaces as SessionNotReady so `--all` can continue to the next leg.
        try:
            holdings, acc_id = asyncio.run(_collect_moomoo())
        except Exception as exc:  # noqa: BLE001 - audit, then re-raise
            writer.write_run(db, "moomoo", snapshot_date, run_at, "error", error=str(exc), is_eod=is_eod)
            raise SessionNotReady(f"moomoo snapshot failed: {exc}") from exc
        base = Settings().base_currency
        run_id = writer.write_run(db, "moomoo", snapshot_date, run_at, "running", is_eod=is_eod)
        try:
            persist(
                db, run_id, run_at, holdings, snapshot_date, base, is_eod,
                account_ref=acc_id or "",
            )
        except Exception as exc:  # noqa: BLE001 - audit-only; never fail un-audited
            writer.update_run(db, run_id, "error", 0, error=str(exc))
            raise SessionNotReady(f"moomoo snapshot failed: {exc}") from exc
        writer.update_run(db, run_id, "ok", len(holdings))
        if is_eod and acc_id:
            # Daily trade + funds capture (best-effort; XIRR input). The same
            # injected `at` gates it inside capture_trades (trading-day policy).
            try:
                from portfolio.trades import capture_trades

                capture_trades("moomoo", db_path=db_path, at=at)
            except Exception:  # noqa: BLE001 - must never fail the holdings run
                logger.warning("moomoo trade/funds capture failed", exc_info=True)
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
            holdings = normalize_moomoo(payload, sectors=load_sectors())
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


# ---- live polling (M6) ------------------------------------------------------
#
# Fast live polls that update `position` in place WITHOUT writing to
# position_snapshot, price_history, fx_rates, or runs. Ephemeral, no audit trail.
# Uses the same collection logic as snapshots but with is_eod=False and
# live_poll=True on persist().


async def _live_poll_zerodha(*, port: int = DEFAULT_PORT, db_path: Path = DB_PATH) -> list[Holding]:
    """Fetch live Zerodha holdings via daemon RPC and upsert to `position` only."""

    # Ensure daemon is up (reuses the same logic as snapshots)
    ensure_zerodha_daemon()
    raw = _fetch(port, "get_holdings", {})

    if _session_expired(raw):
        send_snapshot_expiry_warning("zerodha", "session expired", settings=Settings())
        raise SessionNotReady("Zerodha session expired - run `portfolio serve --platform zerodha` to re-login")

    payload = raw.get("parse", [])
    if not isinstance(payload, list):
        raise SessionNotReady(f"unexpected holdings payload: {type(payload).__name__}")

    holdings = normalize_zerodha(payload, sectors=load_sectors(), names=load_names())

    # Persist to position table only (is_eod=False, live_poll=True skips fx_rates)
    run_at = datetime.now(UTC).isoformat()
    snapshot_date = datetime.now(UTC).astimezone(_IST).date().isoformat()
    base = Settings().base_currency
    db = _db_connection(db_path)
    try:
        # run_id=0 for live polls (no runs row)
        persist(db, 0, run_at, holdings, snapshot_date, base, is_eod=False, live_poll=True)
    finally:
        db.close()
    return holdings


async def _live_poll_moomoo(*, db_path: Path = DB_PATH) -> tuple[list[Holding], str | None]:
    """Fetch live Moomoo holdings via OpenD wrapper and upsert to `position` only."""
    try:
        holdings, acc_id = await _collect_moomoo()
    except Exception as exc:  # noqa: BLE001
        raise SessionNotReady(f"moomoo live poll failed: {exc}") from exc

    # Persist to position table only (is_eod=False, live_poll=True skips fx_rates)
    run_at = datetime.now(UTC).isoformat()
    snapshot_date = datetime.now(UTC).astimezone(_IST).date().isoformat()
    base = Settings().base_currency
    db = _db_connection(db_path)
    try:
        persist(
            db, 0, run_at, holdings, snapshot_date, base, is_eod=False, live_poll=True,
            account_ref=acc_id or "",
        )
    finally:
        db.close()
    return holdings, acc_id


def _live_poll(platform: str, db_path: Path = DB_PATH) -> dict[str, Any]:
    """Run a live poll for the given platform and return fresh holdings JSON."""
    import asyncio
    from datetime import UTC, datetime

    if platform not in ("zerodha", "moomoo", "all"):
        raise ValueError(f"unknown platform: {platform!r}")

    results: dict[str, Any] = {"holdings": [], "asOf": datetime.now(UTC).isoformat(), "platforms": {}}

    if platform == "zerodha" or platform == "all":
        try:
            holdings = asyncio.run(_live_poll_zerodha(db_path=db_path))
            results["holdings"].extend([h.as_record() for h in holdings])
            results["platforms"]["zerodha"] = {"status": "ok", "count": len(holdings)}
        except SessionNotReady as exc:
            results["platforms"]["zerodha"] = {"status": "error", "error": str(exc)}
        except Exception as exc:  # noqa: BLE001
            results["platforms"]["zerodha"] = {"status": "error", "error": f"unexpected: {exc}"}

    if platform == "moomoo" or platform == "all":
        try:
            holdings, acc_id = asyncio.run(_live_poll_moomoo(db_path=db_path))
            results["holdings"].extend([h.as_record() for h in holdings])
            results["platforms"]["moomoo"] = {"status": "ok", "count": len(holdings), "account": acc_id}
        except SessionNotReady as exc:
            results["platforms"]["moomoo"] = {"status": "error", "error": str(exc)}
        except Exception as exc:  # noqa: BLE001
            results["platforms"]["moomoo"] = {"status": "error", "error": f"unexpected: {exc}"}

    return results


# ---- persistence -----------------------------------------------------------
#
# The shared write path lives in portfolio.db.persist (MINOR-3) so snapshot,
# CAS import and the AMFI NAV refresh all persist through the same module
# instead of importing each other's privates.

# ---- daemon RPC ----------------------------------------------------------


# serve.py waits up to 300s for the daily browser login; give the health poll
# a little headroom so a successful login is never raced.
DAEMON_START_TIMEOUT_SECONDS = 330.0
# Wait for an existing daemon (e.g. the 09:35 scheduled one) to complete
# authentication before spawning a replacement. The daemon may be in the
# middle of the manual 2FA browser login when a snapshot run fires.
DAEMON_AUTH_WAIT_SECONDS = 60.0
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

    If a daemon process exists but isn't authenticated yet (e.g. the 09:35
    scheduled daemon is still waiting for the user to complete 2FA in the
    browser), we poll /health for up to 60 seconds waiting for auth to complete
    before spawning a new daemon. This prevents a SECOND daemon and a SECOND
    browser login prompt.

    Set PORTFOLIO_NO_DAEMON=1 to skip auto-launch (daemon managed elsewhere).
    """
    if os.environ.get("PORTFOLIO_NO_DAEMON"):
        return
    health = daemon_health()
    if health and health.get("ok"):
        # Daemon is up and connected to MCP. Check auth status.
        if health.get("auth"):
            # Fully healthy - ready to serve
            return
        # Daemon exists but not authenticated yet (waiting for 2FA).
        # Wait for it to complete authentication before spawning a replacement.
        logger.info("zerodha daemon exists but not authenticated yet - waiting up to %.0fs for auth", DAEMON_AUTH_WAIT_SECONDS)
        deadline = time.monotonic() + DAEMON_AUTH_WAIT_SECONDS
        while time.monotonic() < deadline:
            time.sleep(3)
            health = daemon_health()
            if health and health.get("ok") and health.get("auth"):
                logger.info("zerodha daemon authenticated during wait")
                return
            if not health:
                # Daemon died while we were waiting - break to spawn new one
                logger.warning("zerodha daemon disappeared during auth wait")
                break
        # Timed out or daemon died - fall through to spawn new one
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


def _db_connection(db_path: Path):
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return connect(path)
