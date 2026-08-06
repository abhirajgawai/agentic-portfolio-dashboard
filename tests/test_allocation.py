"""Consolidated allocation tests: sums to 100% per dimension, INR base."""

from __future__ import annotations

import pytest

from portfolio.normalize.allocation import UNKNOWN, Allocation, compute_allocation
from portfolio.normalize.schema import Holding

# 1 USD = 90 INR (fixed test rate)
RATES = {"INR": 1.0, "USD": 90.0}


def h(
    platform: str,
    ticker: str,
    currency: str,
    value_ccy: float,
    geography: str,
    sector: str | None = None,
    asset_class: str | None = None,
) -> Holding:
    return Holding(
        platform=platform,
        geography=geography,
        ticker=ticker,
        name=ticker,
        quantity=1.0,
        avg_price=value_ccy,
        current_price=value_ccy,
        cost_basis=value_ccy,
        current_value=value_ccy,
        currency=currency,
        sector=sector,
        asset_class=asset_class,
    )


def test_each_dimension_sums_to_total():
    holdings = [
        h("zerodha", "INFY", "INR", 5_000.0, "IN", sector="IT", asset_class="equity"),
        h("moomoo", "AAPL", "USD", 100.0, "US", sector="Tech", asset_class="equity"),  # 9,000 INR
        h("moomoo", "BND", "USD", 50.0, "US", sector="Fixed Income", asset_class="bond"),  # 4,500 INR
    ]
    alloc = compute_allocation(holdings, RATES)

    assert alloc.total_base == pytest.approx(5_000 + 9_000 + 4_500)
    for dim in ("geography", "platform", "sector", "asset_class"):
        assert sum(alloc.dimension(dim).values()) == pytest.approx(alloc.total_base)


def test_shares_sum_to_100():
    holdings = [
        h("zerodha", "INFY", "INR", 5_000.0, "IN", sector="IT", asset_class="equity"),
        h("moomoo", "AAPL", "USD", 100.0, "US", sector="Tech", asset_class="equity"),
    ]
    alloc = compute_allocation(holdings, RATES)
    for dim in ("geography", "platform", "sector", "asset_class"):
        assert sum(alloc.shares(dim).values()) == pytest.approx(100.0)


def test_unknown_bucket_keeps_sums_honest():
    holdings = [h("zerodha", "MISSING", "INR", 1_000.0, "IN")]  # no sector/asset_class
    alloc = compute_allocation(holdings, RATES)
    assert alloc.by_sector[UNKNOWN] == pytest.approx(1_000.0)
    assert alloc.by_asset_class[UNKNOWN] == pytest.approx(1_000.0)
    assert sum(alloc.shares("sector").values()) == pytest.approx(100.0)


def test_geography_split():
    holdings = [
        h("zerodha", "A", "INR", 5_000.0, "IN"),
        h("moomoo", "B", "USD", 50.0, "US"),  # 4,500 INR
    ]
    alloc = compute_allocation(holdings, RATES)
    assert alloc.by_geography["IN"] == pytest.approx(5_000.0)
    assert alloc.by_geography["US"] == pytest.approx(4_500.0)


def test_deterministic_and_empty():
    holdings = [h("moomoo", "AAPL", "USD", 100.0, "US", sector="Tech", asset_class="equity")]
    assert compute_allocation(holdings, RATES) == compute_allocation(holdings, RATES)

    empty = compute_allocation([], RATES)
    assert empty.total_base == 0.0
    assert all(empty.shares(d) == {} for d in ("geography", "platform", "sector", "asset_class"))


def test_allocation_immutable():
    alloc = compute_allocation([h("moomoo", "AAPL", "USD", 100.0, "US")], RATES)
    assert isinstance(alloc, Allocation)
    with pytest.raises(TypeError):
        alloc.by_geography["US"] = 1.0  # read-only mapping
