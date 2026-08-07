"""Zerodha normalizer: raw get_holdings JSON -> common holding schema.

Raw shape (Kite Connect v3 holdings, as text-JSON from the MCP tool):
    [{"tradingsymbol": "INFY", "exchange": "NSE", "quantity": 5,
      "average_price": 1000.0, "last_price": 1010.0, ...}, ...]

Ticker = tradingsymbol; geography IN; currency INR. cost_basis = avg*qty,
current_value = last_price*qty. Name/sector/asset_class enrich from a curated
sectors map if provided, else null.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from typing import Any

from portfolio.normalize.schema import Holding, required_float, to_float

logger = logging.getLogger("portfolio.normalize.zerodha")


def _pnl_pct(pnl: float | None, cost_basis: float | None) -> float | None:
    if pnl is None or not cost_basis:
        return None
    return pnl / cost_basis * 100.0


def normalize_holdings(
    raw: list[Mapping[str, Any]],
    *,
    platform: str = "zerodha",
    geography: str = "IN",
    currency: str = "INR",
    sectors: Mapping[str, tuple[str | None, str | None]] | None = None,
) -> list[Holding]:
    """Map a Kite holdings payload (list of dicts) to the common schema.

    Full-fidelity (M2.5): day P&L / prev close / total P&L / isin / exchange are
    stored alongside the core fields, and the raw Kite row is kept in raw_json
    so no broker detail is ever lost.
    """
    sectors = sectors or {}
    out: list[Holding] = []
    for item in raw:
        ticker = (item.get("tradingsymbol") or item.get("trading_symbol"))
        if not ticker:
            logger.warning("holding row without tradingsymbol skipped")
            continue

        quantity = required_float(item.get("quantity"), "quantity", ticker)
        current_price = required_float(item.get("last_price"), "last_price", ticker)
        avg_price = to_float(item.get("average_price"))

        cost_basis = None
        if avg_price is not None:
            cost_basis = avg_price * quantity
        current_value = current_price * quantity

        sector, asset_class = sectors.get(ticker, (None, None))
        pnl = to_float(item.get("pnl"))

        out.append(
            Holding(
                platform=platform,
                geography=geography,
                ticker=ticker,
                name=item.get("name") if item.get("name") else None,
                quantity=quantity,
                avg_price=avg_price,
                current_price=current_price,
                cost_basis=cost_basis,
                current_value=current_value,
                currency=currency,
                sector=sector,
                asset_class=asset_class,
                isin=item.get("isin") or None,
                exchange=item.get("exchange") or None,
                prev_close=to_float(item.get("close_price")),
                day_change_ccy=to_float(item.get("day_change")),
                day_change_pct=to_float(item.get("day_change_percentage")),
                pnl_ccy=pnl,
                pnl_pct=_pnl_pct(pnl, cost_basis),
                position_side="LONG",
                raw_json=json.dumps(item, default=str),
            )
        )
    logger.debug("normalized %d zerodha holdings", len(out))
    return out