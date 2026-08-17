"""Daily trade + account-funds capture (XIRR inputs, M2.5/M3).

Brokers expose today's executed trades read-only:
  - zerodha `get_trades`  (same-day only - MUST capture daily, no backfill)
  - moomoo  `get_fills`   (deal_list_query, today)
They become `trade` rows (SIGNED quantity/amount: +buy / -sell), deduped by
UNIQUE(account_id, external_id) via writer.upsert_trade's DO NOTHING - so a
re-run today reports "0 new trades (N seen)".

Funds: zerodha `get_margins` / moomoo `get_funds` -> `account_funds`, best-effort.

Trade capture is best-effort: a failure must never fail the holdings snapshot.

(Note: Groww had a paid-Trade-API leg planned here, but the docs confirmed the
API is equities-only (no MF instrument type), so it was removed - Groww comes
via the free CAS import instead.)
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from portfolio.calendars import gate_check
from portfolio.config import DB_PATH, platform_display_currency, platform_geography
from portfolio.db import connect, writer
from portfolio.serve import DEFAULT_PORT

logger = logging.getLogger("portfolio.trades")

# Asia/Kolkata is the ledger's market-date timezone (NIT-2 convention).
_IST = ZoneInfo("Asia/Kolkata")


class SessionNotReady(Exception):
    """Broker session/token is not usable for trade capture."""


# The snapshot module owns daemon lifecycle + the daemon RPC helper; re-export
# here so tests patch these at the `portfolio.trades` module level.
def ensure_zerodha_daemon(**kwargs) -> None:
    from portfolio.snapshot import ensure_zerodha_daemon as _fn

    return _fn(**kwargs)


def _fetch(port: int, tool: str, args: dict[str, Any]) -> dict[str, Any]:
    from portfolio.snapshot import _fetch as _fn

    return _fn(port, tool, args)


# ---- dispatcher ---------------------------------------------------------------


def capture_trades(
    platform: str,
    *,
    db_path=DB_PATH,
    port: int = DEFAULT_PORT,
    at: datetime | None = None,
) -> str:
    """Capture one platform's daily trades (+ funds). Returns a summary string.

    Calendar-gated PER LEG with the trading-day policy (is_eod=True, MAJOR-2):
    a closed market writes an audited platform='trades' `skipped` runs row and
    returns a skip summary WITHOUT touching the broker - a holiday is not a
    failure. `at` is the injected wall clock (default now(UTC)); the gate
    never reads the clock itself.
    """
    if platform == "all":
        return _capture_all(db_path, port, at)
    if platform == "zerodha":
        return _capture_gated("zerodha", db_path, port, at)
    if platform == "moomoo":
        return _capture_gated("moomoo", db_path, port, at)
    raise ValueError(f"unknown platform: {platform!r}")


def _capture_gated(platform: str, db_path, port: int, at: datetime | None) -> str:
    """Gate one leg, then capture. Defense-in-depth: the CLI pre-gates single
    platforms and `--all` gates per leg, so this only fires for direct callers
    (e.g. the snapshot legs) - and for them the answer is the same gate at the
    same instant, so a passing snapshot leg always passes here too."""
    at = at or datetime.now(UTC)
    reason = gate_check(platform_geography(platform), at, is_eod=True)
    if reason:
        _write_skip(db_path, reason, at)
        return f"skipped ({reason})"
    if platform == "zerodha":
        return _capture_zerodha(db_path, port)
    return asyncio.run(_capture_moomoo(db_path))


def _capture_all(db_path, port: int, at: datetime | None) -> str:
    """Per-leg gated `--all` (MAJOR-2): a closed leg is skipped with an audited
    platform='trades' row and NEVER touches its broker; open legs capture.

    - All legs closed -> combined skip summary, exit 0 (not a failure).
    - Any leg that RAN and failed -> raise SessionNotReady with the combined
      message. The caller (the CLI) flips its own platform='trades' run row to
      'error' and exits non-zero on that raise - no double-write here.
    """
    at = at or datetime.now(UTC)
    parts: list[str] = []
    errors: list[str] = []
    ran = False
    # Per-leg skip rows share platform='trades', so their started_at must
    # differ (runs.UNIQUE(platform, started_at)) - offset each row by a
    # microsecond from one base instant.
    base = datetime.now(UTC)
    for i, leg in enumerate(("zerodha", "moomoo")):
        reason = gate_check(platform_geography(leg), at, is_eod=True)
        if reason:
            started_at = (base + timedelta(microseconds=i)).isoformat()
            _write_skip(db_path, f"{leg}: {reason}", at, started_at=started_at)
            parts.append(f"{leg}: skipped ({reason})")
            continue
        ran = True
        try:
            parts.append(f"{leg}: " + capture_trades(leg, db_path=db_path, port=port, at=at))
        except Exception as exc:  # noqa: BLE001 - one bad leg must never kill the others
            errors.append(f"{leg}: {exc}")
            parts.append(f"{leg}: FAILED - {exc}")
    if not ran:
        return "; ".join(parts)  # every leg closed: skip rows already audited
    if errors:
        raise SessionNotReady("; ".join(errors))
    return "; ".join(parts)


def _write_skip(db_path, reason: str, at: datetime, *, started_at: str | None = None) -> None:
    """Audited 'skipped' runs row for a closed market (platform='trades').

    snapshot_date is the market date of the evaluated instant (`at`);
    started_at defaults to the real now (per-attempt audit instant).
    """
    snapshot_date = at.astimezone(_IST).date().isoformat()
    db = connect(db_path)
    try:
        writer.write_skipped(
            db, "trades", snapshot_date,
            started_at or datetime.now(UTC).isoformat(),
            reason, is_eod=True,
        )
    finally:
        db.close()


# ---- zerodha (sync, daemon RPC) -----------------------------------------------


def _capture_zerodha(db_path, port: int) -> str:
    ensure_zerodha_daemon()
    raw = _fetch(port, "get_trades", {})
    if raw.get("login_required"):
        raise SessionNotReady("zerodha session expired - trades not captured")
    db = connect(db_path)
    try:
        seen = new = 0
        for item in raw.get("parse") or []:
            seen += 1
            if _write_zerodha_trade(db, item):
                new += 1
        _capture_zerodha_funds(db, port)  # best-effort
        return f"{new} new trades ({seen} seen)"
    finally:
        db.close()


def _write_zerodha_trade(db: Any, item: dict) -> bool:
    ticker = item.get("tradingsymbol")
    trade_id = item.get("trade_id")
    if not ticker or not trade_id:
        return False
    qty = float(item.get("quantity") or 0)
    price = float(item.get("average_price") or item.get("price") or 0)
    side = str(item.get("transaction_type") or "").upper()
    signed_qty = -qty if side == "SELL" else qty
    date = str(item.get("trade_timestamp") or item.get("fill_timestamp") or item.get("order_timestamp") or "")[:10]
    acc = writer.ensure_account(db, "zerodha", base_currency=platform_display_currency("zerodha"))
    inst = writer.ensure_instrument(db, "zerodha", ticker, currency="INR", geography="IN")
    return writer.upsert_trade(
        db, None, acc, inst, trade_date=date, quantity=signed_qty, price=price,
        amount_ccy=signed_qty * price, currency="INR", external_id=str(trade_id),
    )


def _capture_zerodha_funds(db: Any, port: int) -> None:
    margins = _fetch(port, "get_margins", {})
    if margins.get("login_required"):
        return
    equity = (margins.get("parse") or {}).get("equity", {}) if isinstance(margins.get("parse"), dict) else {}
    available = equity.get("available", {}) or {}
    cash = _num(available.get("cash"))
    collateral = _num(available.get("collateral"))
    acc = writer.ensure_account(db, "zerodha", base_currency=platform_display_currency("zerodha"))
    writer.upsert_account_funds(
        db, acc, _today(), "INR",
        total_assets_ccy=None, market_value_ccy=None, cash_ccy=cash,
        buying_power_ccy=(cash + collateral) if cash is not None and collateral is not None else None,
        fetched_at=_now(),
    )


# ---- moomoo (async, OpenD wrapper) --------------------------------------------


async def _capture_moomoo(db_path) -> str:
    from portfolio.clients.moomoo import MoomooMCPClient
    from portfolio.snapshot import _pick_real_account

    async with MoomooMCPClient() as client:
        acc_res = await client.call("get_accounts")
        acc_id = _pick_real_account(acc_res.json()) if not acc_res.is_error else None
        if not acc_id:
            raise SessionNotReady("moomoo: no REAL trading account - trades not captured")
        fills = await client.call("get_fills", {"trd_env": "REAL", "acc_id": acc_id, "trd_market": "US"})
        data = fills.json() or {}
        items = data.get("fills", []) if isinstance(data, dict) else []
        db = connect(db_path)
        try:
            seen = new = 0
            for item in items:
                seen += 1
                if _write_moomoo_trade(db, acc_id, item):
                    new += 1
            funds = await client.call("get_funds", {"trd_env": "REAL", "acc_id": acc_id, "currency": "USD"})
            if not funds.is_error:
                _write_moomoo_funds(db, acc_id, funds.json())
            return f"{new} new trades ({seen} seen)"
        finally:
            db.close()


def _write_moomoo_trade(db: Any, acc_id: str, item: dict) -> bool:
    code = item.get("code") or item.get("security_code")
    deal_id = item.get("deal_id") or item.get("trade_id") or item.get("id")
    if not code or deal_id is None:
        return False
    ticker = code.split(".")[-1]
    qty = float(item.get("qty") or 0)
    price = float(item.get("price") or 0)
    side = str(item.get("trd_side") or item.get("side") or "").upper()
    signed_qty = -qty if side == "SELL" else qty
    date = str(item.get("time") or item.get("business_time") or "")[:10]
    currency = item.get("currency") or "USD"
    acc = writer.ensure_account(db, "moomoo", account_ref=acc_id, base_currency=platform_display_currency("moomoo"))
    inst = writer.ensure_instrument(db, "moomoo", ticker, currency=currency, geography="US")
    return writer.upsert_trade(
        db, None, acc, inst, trade_date=date, quantity=signed_qty, price=price,
        amount_ccy=signed_qty * price, currency=currency, external_id=str(deal_id),
    )


def _write_moomoo_funds(db: Any, acc_id: str, payload: Any) -> None:
    if not isinstance(payload, dict):
        return
    acc = writer.ensure_account(db, "moomoo", account_ref=acc_id, base_currency=platform_display_currency("moomoo"))
    currency = payload.get("currency") or "USD"
    writer.upsert_account_funds(
        db, acc, _today(), currency,
        total_assets_ccy=_num(payload.get("total_assets")),
        market_value_ccy=_num(payload.get("market_val")),
        cash_ccy=_num(payload.get("cash")),
        buying_power_ccy=_num(payload.get("buying_power")),
        fetched_at=_now(),
    )


# ---- helpers ------------------------------------------------------------------


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _today() -> str:
    # Market date in Asia/Kolkata - never machine-local (NIT-2 convention).
    return datetime.now(_IST).date().isoformat()


def _now() -> str:
    return datetime.now(UTC).isoformat()
