"""M5 returns + XIRR tests: solver math, None semantics, DB-backed account path.

This math earns pins: the solver fixtures are hand-computable, the degenerate
inputs lock the None-without-crashing contract, and the DB-backed test proves
the sign convention end-to-end (fixtures written with the exact +buy/-sell
signed amounts the trades.py writers store - see returns.py's convention note).

Determinism: every test feeds explicit dates/amounts; no wall clock, no
randomness, fixed precision + iteration caps.
"""

from __future__ import annotations

from datetime import date

import pytest

from portfolio.db import connect, writer
from portfolio.db.migrate import migrate
from portfolio.returns import (
    account_xirrs,
    per_holding_return,
    portfolio_simple_return,
    series_change_pct,
    xirr,
)

# ---- the solver ---------------------------------------------------------------


def test_xirr_single_buy_one_year():
    """1000 out at day 0, 1100 in at day +365 -> exactly 10% annualized.

    Hand check: 1100 = 1000 * (1 + r)^(365/365)  =>  r = 1.1 - 1 = 0.10.
    """
    flows = [("2026-01-01", -1000.0), ("2027-01-01", 1100.0)]
    assert xirr(flows) == pytest.approx(0.10, abs=1e-6)


def test_xirr_sell_half_year():
    """1000 out at day 0, 1100 in at day +183 -> r = 1.1^(365/183) - 1.

    Hand check: ln(1.1) = 0.09531018; * 365/183 (= 1.99453552) = 0.19009954;
    e^0.19009954 = 1.20937  =>  r ~= 0.2094 (20.94%). NOTE: the M5 brief's
    "≈21.74%" placeholder does not survive a 183-day holding - this is the
    hand-computed value the solver must return (decision flagged in report).
    """
    flows = [("2026-01-01", -1000.0), ("2026-07-03", 1100.0)]  # exactly 183 days
    assert xirr(flows) == pytest.approx(0.2094, abs=1e-4)


def test_xirr_degenerate_inputs_are_none():
    """No solution -> None, never a raise."""
    assert xirr([]) is None  # no flows
    assert xirr([("2026-01-01", -1000.0)]) is None  # single flow
    no_spread = [("2026-01-01", -1000.0), ("2026-01-01", 1100.0)]
    assert xirr(no_spread) is None  # t=0 for both, sum != 0 -> no root
    degenerate = [("2026-01-01", -1000.0), ("2026-01-01", 1000.0)]
    assert xirr(degenerate) is None  # t=0 for both, sum == 0 -> any r solves
    assert xirr([("2026-01-01", -1000.0), ("2027-01-01", -500.0)]) is None  # all negative
    assert xirr([("2026-01-01", 100.0), ("2027-01-01", 110.0)]) is None  # all positive
    assert xirr([("2026-01-01", 0.0), ("2026-06-01", 0.0)]) is None  # zeros dropped
    assert xirr([("garbage", -1000.0), ("2027-01-01", 1100.0)]) is None  # unparseable date


def test_xirr_unsorted_flow_order_and_date_objects():
    """The solver sorts internally - order/date-object inputs don't matter."""
    flows = [(date(2027, 1, 1), 1100.0), (date(2026, 1, 1), -1000.0)]
    assert xirr(flows) == pytest.approx(0.10, abs=1e-6)


# ---- simple returns ------------------------------------------------------------


def test_per_holding_return_with_missing_cost():
    assert per_holding_return(None, 100.0) is None  # NULL cost (M3 CAS leg)
    assert per_holding_return(0.0, 100.0) is None  # zero cost
    assert per_holding_return(50.0, None) is None
    assert per_holding_return(50.0, 60.0) == pytest.approx(0.20)
    assert portfolio_simple_return(1000.0, 1100.0) == pytest.approx(0.10)
    assert portfolio_simple_return(None, 1100.0) is None


def test_series_change_pct():
    series = {
        "dates": ["2026-01-01", "2026-01-02", "2026-01-03"],
        "portfolioValueBase": [100.0, 105.0, 110.0],
    }
    assert series_change_pct(series, 1) == pytest.approx((110.0 - 105.0) / 105.0 * 100.0)
    assert series_change_pct(series, 7) is None  # history too short for the window
    assert series_change_pct({"dates": ["2026-01-01"], "portfolioValueBase": [100.0]}, 1) is None
    # Mixed-frequency legs: a gap picks the newest point INSIDE the window
    # (honest window semantics, not "pretend it is a 1-day move").
    gapped = {"dates": ["2026-06-30", "2026-08-14"], "portfolioValueBase": [100.0, 110.0]}
    assert series_change_pct(gapped, 1) == pytest.approx(10.0)


# ---- DB-backed per-account XIRR -----------------------------------------------


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "t.db"
    migrate(path)
    return path


def _seed_xirr_account(conn) -> int:
    """zerodha account: BUY 10 @ 100 (2026-01-01) then SELL 10 @ 110
    (2027-01-01) - the EXACT signed amounts the trades.py writers store
    (amount_ccy = +1000 buy / -1100 sell); returns are computed on -amount_ccy."""
    acc = writer.ensure_account(conn, "zerodha", base_currency="INR")
    inst = writer.ensure_instrument(conn, "zerodha", "TEST", currency="INR", geography="IN")
    writer.upsert_trade(
        conn, None, acc, inst, trade_date="2026-01-01",
        quantity=10.0, price=100.0, amount_ccy=1000.0, currency="INR", external_id="T1",
    )
    writer.upsert_trade(
        conn, None, acc, inst, trade_date="2027-01-01",
        quantity=-10.0, price=110.0, amount_ccy=-1100.0, currency="INR", external_id="T2",
    )
    # Fully sold: the current position value is 0 -> terminal flow 0.0 (no-op).
    writer.upsert_position(
        conn, acc, inst, quantity=0.0, avg_cost=None, price=0.0,
        cost_value_ccy=None, market_value_ccy=0.0, market_value_base=0.0,
        cost_value_base=None, updated_at="2027-01-01T00:00:00+00:00",
    )
    return acc


def test_account_xirr_db_backed(db):
    conn = connect(db)
    try:
        _seed_xirr_account(conn)
        results = account_xirrs(conn, today="2027-01-01")
        # Fresh db: the zerodha account is id 1 and stores no account_ref, so
        # the key falls back to the numeric id (empty-ref collision guard).
        assert set(results) == {"zerodha__1"}
        acc = results["zerodha__1"]
        assert acc.currency == "INR"
        assert acc.terminal_value == 0.0
        assert acc.flow_count == 2  # buy + sell; the 0.0 terminal is dropped
        # flows are the NEGATED stored signs: -1000 (buy outflow), +1100 (sell inflow)
        assert acc.flows == [("2026-01-01", -1000.0), ("2027-01-01", 1100.0)]
        assert acc.xirr_rate == pytest.approx(0.10, abs=1e-6)
    finally:
        conn.close()


def test_terminal_value_flow_is_dated_today(db):
    """A group with an open (not sold) position: the terminal value is dated
    `today` and the solver sees it as a positive inflow."""
    conn = connect(db)
    try:
        acc = writer.ensure_account(conn, "zerodha", base_currency="INR")
        inst = writer.ensure_instrument(conn, "zerodha", "TEST", currency="INR", geography="IN")
        writer.upsert_trade(
            conn, None, acc, inst, trade_date="2026-01-01",
            quantity=10.0, price=100.0, amount_ccy=1000.0, currency="INR", external_id="T1",
        )
        writer.upsert_position(
            conn, acc, inst, quantity=10.0, avg_cost=100.0, price=110.0,
            cost_value_ccy=1000.0, market_value_ccy=1100.0, market_value_base=1100.0,
            cost_value_base=1000.0, updated_at="2027-01-01T00:00:00+00:00",
        )
        results = account_xirrs(conn, today="2027-01-01")
        acc_res = results["zerodha__1"]
        assert acc_res.terminal_value == pytest.approx(1100.0)
        assert acc_res.flow_count == 2  # buy + terminal
        # -1000 at day 0, +1100 terminal ON the same date as the last trade
        # (today == trade date -> 365-day spread) -> 10%
        assert acc_res.xirr_rate == pytest.approx(0.10, abs=1e-6)
    finally:
        conn.close()


def test_account_without_trades_is_absent(db):
    """No captured trades -> the account is not in the export (flows genuinely
    missing, not a computation failure)."""
    conn = connect(db)
    try:
        writer.ensure_account(conn, "moomoo", base_currency="SGD")
        assert account_xirrs(conn, today="2027-01-01") == {}
    finally:
        conn.close()