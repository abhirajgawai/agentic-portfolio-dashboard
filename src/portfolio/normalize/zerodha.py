"""Zerodha normalizer: raw get_holdings JSON -> common holding schema.

Raw shape (Kite Connect v3 holdings, as text-JSON from the MCP tool):
    [{"tradingsymbol": "INFY", "exchange": "NSE", "quantity": 5,
      "average_price": 1000.0, "last_price": 1010.0, ...}, ...]

Ticker = tradingsymbol; geography IN; currency INR. cost_basis = avg*qty,
current_value = last_price*qty. Name/sector/asset_class enrich from a curated
sectors map if provided, else null.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

from portfolio.normalize.schema import Holding, required_float, to_float

logger = logging.getLogger("portfolio.normalize.zerodha")


def normalize_holdings(
    raw: list[Mapping[str, Any]],
    *,
    platform: str = "zerodha",
    geography: str = "IN",
    currency: str = "INR",
    sectors: Mapping[str, tuple[str | None, str | None]] | None = None,
) -> list[Holding]:
    """Map a Kite holdings payload (list of dicts) to the common schema."""
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
            )
        )
    logger.debug("normalized %d zerodha holdings", len(out))
    return out