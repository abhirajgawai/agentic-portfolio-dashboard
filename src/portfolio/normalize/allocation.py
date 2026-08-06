"""Consolidated allocation in base currency (M2).

Takes one run's normalized holdings (across platforms) plus the run's FX rates
and returns the value distribution by geography / platform / sector / asset
class. Every dimension sums to the total, i.e. 100% of the portfolio -
the M2 acceptance bar (`snapshot --all` allocation sums to 100%).

Deterministic: same holdings + same rates -> same output. Keys are sorted so
the JSON contract (M8) is stable regardless of dict insertion order.

Currency conversion uses the run's one-rate-per-run table ({currency: rate}),
so a holding's base value here is EXACTLY the value persisted in the position
row (snapshot._persist computes market_value_base with the same rates).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType

from portfolio.normalize.schema import Holding

# A holding with no sector/asset_class enrichment falls under "unknown" so the
# dimension still sums to 100% (the dashboard's donut must never lose value).
UNKNOWN = "unknown"

DIMENSIONS = ("geography", "platform", "sector", "asset_class")


@dataclass(frozen=True)
class Allocation:
    """Value distribution for one run, all values in base currency."""

    total_base: float
    by_geography: dict[str, float] = field(default_factory=dict)
    by_platform: dict[str, float] = field(default_factory=dict)
    by_sector: dict[str, float] = field(default_factory=dict)
    by_asset_class: dict[str, float] = field(default_factory=dict)

    def dimension(self, name: str) -> dict[str, float]:
        return getattr(self, f"by_{name}")

    def shares(self, name: str) -> dict[str, float]:
        """Percentage of total per key; sums to 100 (or 0 for an empty run)."""
        dim = self.dimension(name)
        if self.total_base <= 0:
            return {k: 0.0 for k in dim}
        return {k: value / self.total_base * 100.0 for k, value in dim.items()}


def compute_allocation(
    holdings: list[Holding],
    fx_rates: Mapping[str, float],
    *,
    base: str = "INR",
) -> Allocation:
    """Allocate one run's holdings across the four M8 dashboard dimensions.

    fx_rates maps a holding's currency to the base-conversion rate
    (value_base = value_ccy * rate); identity currencies (INR) must be present
    as 1.0 (get_fx_rates() supplies that for callers who build the table).
    """
    totals: dict[str, dict[str, float]] = {d: {} for d in DIMENSIONS}
    total = 0.0

    for h in holdings:
        rate = fx_rates.get(h.currency, 1.0)
        value = h.current_value * rate
        total += value
        for dim, key in (
            ("geography", h.geography or UNKNOWN),
            ("platform", h.platform),
            ("sector", h.sector or UNKNOWN),
            ("asset_class", h.asset_class or UNKNOWN),
        ):
            totals[dim][key] = totals[dim].get(key, 0.0) + value

    return Allocation(
        total_base=total,
        **{
            # MappingProxyType: the allocation is a read-only result - callers
            # must not be able to corrupt a dimension after the fact.
            f"by_{dim}": MappingProxyType(dict(sorted(totals[dim].items())))
            for dim in DIMENSIONS
        },
    )
