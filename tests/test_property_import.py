"""Property import (M8.5): holding + cash-flow trades for XIRR.

The one accuracy rule this guards: property XIRR flows are purchase +
improvements, and the terminal as-if-sold inflow is DERIVED from the position
value by account_xirrs - it must NOT also be written as a trade, or the same
liquidation is counted twice (regression 2026-08-18: TALOJA_PROPERTY showed
18.06% XIRR instead of ~2.46%).
"""

from __future__ import annotations

from portfolio.property_import import build_holding_and_trades

PROP = {
    "property_id": "PROP_TEST_001",
    "address": "1 Test Lane",
    "property_type": "residential",
    "purchase_date": "2020-03-15",
    "purchase_price": 1000000.0,
    "current_valuation": 1500000.0,
    "improvements": [
        {"date": "2021-06-01", "amount": 50000.0, "description": "kitchen"},
        {"date": "2022-11-15", "amount": 30000.0, "description": "bathroom"},
    ],
}


def test_holding_fields() -> None:
    holding, _ = build_holding_and_trades(PROP)
    assert holding.platform == "real_estate"
    assert holding.ticker == "PROP_TEST_001"
    assert holding.quantity == 1.0
    assert holding.cost_basis == 1080000.0  # purchase + both improvements
    assert holding.current_value == 1500000.0


def test_trades_are_purchase_plus_improvements_only() -> None:
    """The terminal as-if-sold is DERIVED by account_xirrs (position value) -
    writing it as a trade would double-count the liquidation."""
    _, trades = build_holding_and_trades(PROP)
    assert [t["external_id"] for t in trades] == [
        "purchase_PROP_TEST_001",
        "improvement_PROP_TEST_001_1",
        "improvement_PROP_TEST_001_2",
    ]
    # Purchase is an outflow (+buy convention), improvements are outflows too.
    assert trades[0]["amount_ccy"] == 1000000.0
    assert sum(t["amount_ccy"] for t in trades) == 1080000.0
    # No terminal trade exists (it would appear as amount_ccy < 0).
    assert all(t["amount_ccy"] > 0 for t in trades)