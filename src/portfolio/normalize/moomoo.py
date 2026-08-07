"""Moomoo normalizer: raw `account_positions` output -> common holding schema.

Raw shape (Futu/Moomoo OpenAPI PositionInfo, as text-JSON from the MCP tool):
    {"data": {"position_list": [{"code": "US.AAPL", "stock_name": "Apple Inc",
      "qty": 10, "cost_price": 150.0, "nominal_price": 155.0,
      "cost_val": 1500.0, "market_val": 1550.0, "pl_ratio": 0.033, ...}]}}

Ticker = symbol after the exchange prefix ("US.AAPL" -> "AAPL"), which is also
the key our curated sectors.csv uses. geography US, currency USD (the account's
settlement currency - positions are not per-currency on Futu).

PositionInfo carries no exchange field (verified in moomoo/trade/trade_query.py
unpack_rsp); `position_market` is a MARKET prefix ("US"), not an exchange - we
store it as the best available coarse value. No scrubbed positions pin exists
(private data); tests use a hand-built fixture mirroring this shape.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from typing import Any

from portfolio.normalize.schema import Holding, required_float, to_float

logger = logging.getLogger("portfolio.normalize.moomoo")


def _extract_position_list(payload: Any) -> list[Mapping[str, Any]]:
    """Locate the position list inside the MCP JSON payload (defensive nesting).

    Handles: a bare list, a list under position_list/positions/list/data, and
    a SINGLE position dict (the OpenD wrapper can return one row as a dict).
    """
    if isinstance(payload, list):
        return [p for p in payload if isinstance(p, Mapping)]
    if not isinstance(payload, Mapping):
        return []
    for key in ("position_list", "positions", "list"):
        value = payload.get(key)
        if isinstance(value, list):
            return [p for p in value if isinstance(p, Mapping)]
    data = payload.get("data")
    if isinstance(data, Mapping):
        for key in ("position_list", "positions", "list"):
            value = data.get(key)
            if isinstance(value, list):
                return [p for p in value if isinstance(p, Mapping)]
        return [data] if "code" in data else []
    return [payload] if "code" in payload else []


def ticker_from_code(code: str) -> str:
    """'US.AAPL' -> 'AAPL'; 'HK.00700' -> '00700'; bare symbols pass through."""
    return code.split(".")[-1].strip() if code else code


def normalize_holdings(
    payload: Any,
    *,
    platform: str = "moomoo",
    geography: str = "US",
    currency: str = "USD",
    sectors: Mapping[str, tuple[str | None, str | None]] | None = None,
) -> list[Holding]:
    """Map a Moomoo account_positions payload to the common schema.

    Full-fidelity (M2.5): day P&L (today_pl_val), total P&L (pl_val/pl_ratio),
    realized/unrealized P&L, sellable qty and side are stored, and the raw
    position dict is kept in raw_json.
    """
    sectors = sectors or {}
    out: list[Holding] = []
    for item in _extract_position_list(payload):
        code = item.get("code") or item.get("security_code") or item.get("symbol")
        if not code:
            logger.warning("moomoo position row without code skipped")
            continue

        quantity = required_float(item.get("qty"), "qty", code)
        current_price = required_float(
            item.get("nominal_price") or item.get("current_price") or item.get("last_price"),
            "nominal_price", code,
        )
        avg_price = to_float(item.get("cost_price"))

        cost_val = to_float(item.get("cost_val"))
        market_val = to_float(item.get("market_val"))
        cost_basis = cost_val if cost_val is not None else (avg_price * quantity if avg_price is not None else None)
        current_value = market_val if market_val is not None else current_price * quantity

        ticker = ticker_from_code(code)
        sector, asset_class = sectors.get(ticker, (None, None))

        # today_pl_val is today's P&L; pl_ratio is P&L% under diluted cost (already %).
        today_pl = to_float(item.get("today_pl_val"))
        pl_ratio = to_float(item.get("pl_ratio"))
        day_change_pct = None
        if today_pl is not None and current_value > today_pl:
            day_change_pct = today_pl / (current_value - today_pl) * 100.0

        out.append(
            Holding(
                platform=platform,
                geography=geography,
                ticker=ticker,
                name=item.get("stock_name") or item.get("name") or None,
                quantity=quantity,
                avg_price=avg_price,
                current_price=current_price,
                cost_basis=cost_basis,
                current_value=current_value,
                currency=currency,
                sector=sector,
                asset_class=asset_class,
                # position_market is a MARKET prefix ("US"), not an exchange,
                # and PositionInfo has no exchange field - keep the coarse
                # market prefix as the best available value. Parenthesized
                # explicitly: `(A or B) if C else None` would silently prefer
                # the code prefix whenever the market is missing (MINOR-2).
                exchange=(item.get("position_market") or (code.split(".")[0] if "." in code else None)),
                prev_close=None,  # Moomoo positions don't carry prev close; snapshot history fills it later
                day_change_ccy=today_pl,
                day_change_pct=day_change_pct,
                pnl_ccy=to_float(item.get("pl_val")),
                pnl_pct=pl_ratio,
                realized_pnl_ccy=to_float(item.get("realized_pl")),
                unrealized_pnl_ccy=to_float(item.get("unrealized_pl")),
                can_sell_qty=to_float(item.get("can_sell_qty")),
                position_side=item.get("position_side"),
                raw_json=json.dumps(item, default=str),
            )
        )
    logger.debug("normalized %d moomoo holdings", len(out))
    return out
