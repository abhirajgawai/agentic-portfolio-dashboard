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