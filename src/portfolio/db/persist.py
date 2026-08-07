"""Shared write-path for one run of holdings (state + history).

Moved out of snapshot.py (MINOR-3): the snapshot legs, CAS import and the AMFI
NAV refresh all persist through here instead of importing snapshot's private
functions. The write pattern is deliberately split by kind so repeated polling
never fills the DB with junk:

  position (live state)  upserted IN PLACE every run - the table does not grow.
  position_snapshot, price_history
                         written only on EOD runs - the daily ledger.
  runs                   one row per run attempt (audit + lineage).

The legacy portfolio_value write path was REMOVED (F1): per-leg writes clobbered
the UNIQUE(value_date, is_eod, scope_type, scope_key) slot ("the last leg wins",
M-3 - live proof: 2026-08-07 `all` excluded the whole CAS leg). The value series
is DERIVED from position_snapshot at export time (portfolio.series); the
portfolio_value table and its historical rows remain in the DB, unread.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from portfolio.config import PLATFORMS, Settings, platform_display_currency
from portfolio.db import writer
from portfolio.fx import get_fx_rate
from portfolio.normalize.schema import Holding

logger = logging.getLogger("portfolio.db.persist")


def persist(
    db: Any,
    run_id: int,
    run_at: str,
    holdings: list[Holding],
    snapshot_date: str,
    base: str,
    is_eod: bool,
    *,
    account_ref: str = "",
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
            isin=rec["isin"], exchange=rec["exchange"],
        )
        rate, fx_rate_id = fx_for(db, snapshot_date, base, rec["currency"], settings, fx_cache)
        value_base = rec["current_value"] * rate
        cost_base = rec["cost_basis"] * rate if rec["cost_basis"] is not None else None

        writer.upsert_position(
            db, account_id, instrument_id,
            quantity=rec["quantity"], avg_cost=rec["avg_price"], price=rec["current_price"],
            cost_value_ccy=rec["cost_basis"], market_value_ccy=rec["current_value"],
            market_value_base=value_base, cost_value_base=cost_base, updated_at=run_at,
            prev_close=rec["prev_close"], day_change_ccy=rec["day_change_ccy"],
            day_change_pct=rec["day_change_pct"], pnl_ccy=rec["pnl_ccy"],
            pnl_pct=rec["pnl_pct"], realized_pnl_ccy=rec["realized_pnl_ccy"],
            unrealized_pnl_ccy=rec["unrealized_pnl_ccy"], can_sell_qty=rec["can_sell_qty"],
            position_side=rec["position_side"], raw_json=rec["raw_json"],
        )
        if is_eod:
            writer.upsert_position_snapshot(
                db, run_id, account_id, instrument_id, fx_rate_id, snapshot_date,
                quantity=rec["quantity"], avg_cost=rec["avg_price"], price=rec["current_price"],
                cost_value_ccy=rec["cost_basis"], market_value_ccy=rec["current_value"],
                market_value_base=value_base, cost_value_base=cost_base,
                prev_close=rec["prev_close"], day_change_ccy=rec["day_change_ccy"],
                day_change_pct=rec["day_change_pct"], pnl_ccy=rec["pnl_ccy"],
                pnl_pct=rec["pnl_pct"], realized_pnl_ccy=rec["realized_pnl_ccy"],
                unrealized_pnl_ccy=rec["unrealized_pnl_ccy"], can_sell_qty=rec["can_sell_qty"],
                position_side=rec["position_side"],
            )
            writer.upsert_price(db, instrument_id, snapshot_date, rec["current_price"], rec["currency"])

    # The dashboard shows the account leg in its display currency (moomoo -> SGD),
    # so persist those rates too - they come from the SAME er-api fetch (cached).
    ensure_display_rates(db, snapshot_date, base, settings)


def ensure_display_rates(
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


def fx_for(
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
