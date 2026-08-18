"""Common holding schema (PLAN.md §4) + normalization helpers.

Deterministic: identical raw input -> identical output. No LLM anywhere here.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from numbers import Real
from typing import Any

# The canonical field set every normalizer must produce.
FIELDS = (
    "platform",
    "geography",
    "ticker",
    "name",
    "quantity",
    "avg_price",
    "current_price",
    "cost_basis",
    "current_value",
    "currency",
    "sector",
    "asset_class",
)


@dataclass(frozen=True)
class Holding:
    platform: str
    geography: str
    ticker: str
    name: str | None
    quantity: float
    avg_price: float | None
    current_price: float
    cost_basis: float | None
    current_value: float
    currency: str
    sector: str | None
    asset_class: str | None

    # ---- enrichment (curated or broker-provided) ----
    isin: str | None = None
    exchange: str | None = None

    # ---- full-fidelity holding detail (M2.5) ----
    prev_close: float | None = None
    # day_change_ccy is the position's TOTAL day P&L in its currency
    # (last - prev_close) * quantity. NOT a per-share value: Kite's get_holdings
    # `day_change` field is per-share, so the zerodha normalizer multiplies by
    # quantity before storing (regression fixed 2026-08-18).
    day_change_ccy: float | None = None
    day_change_pct: float | None = None
    pnl_ccy: float | None = None
    pnl_pct: float | None = None
    realized_pnl_ccy: float | None = None
    unrealized_pnl_ccy: float | None = None
    can_sell_qty: float | None = None
    position_side: str | None = None
    raw_json: str | None = None

    def as_record(self) -> dict[str, Any]:
        return asdict(self)


def to_float(value: Any) -> float | None:
    """Coerce a numeric value to float, tolerating str and None."""
    if value is None:
        return None
    if isinstance(value, Real):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def required_float(value: Any, field: str, ticker: Any) -> float:
    parsed = to_float(value)
    if parsed is None:
        raise ValueError(f"{field!r} missing/not numeric for ticker {ticker!r}")
    return parsed