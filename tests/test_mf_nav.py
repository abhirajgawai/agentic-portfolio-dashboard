"""AMFI NAVAll.txt parser + daily price-refresh path (M-1).

The parser: both ISIN columns indexed, scheme names captured.
The refresh path: `refresh_nav_prices` prices every CAS-derived MF from the
(mocked) feed - position.price updated, price_history + position_snapshot
written, same-day re-runs idempotent, equities skipped.
"""

from __future__ import annotations

import pytest

from portfolio.db import connect, writer
from portfolio.db.migrate import migrate
from portfolio.mf_nav import parse_nav_table, refresh_nav_prices, reset_nav_cache

NAV_TEXT = """Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
Open Ended Schemes(Debt Scheme - Banking and PSU Fund)
Aditya Birla Sun Life Mutual Fund
119551;INF209KA12Z1;INF209KA13Z9;Aditya Birla Sun Life Banking & PSU Debt Fund  - DIRECT - IDCW;107.0834;06-Aug-2026
119550;INF209K01YN0;-;Aditya Birla Sun Life Banking & PSU Debt Fund- Direct Plan-Growth;404.4096;06-Aug-2026
Axis Mutual Fund
120438;INF846K01CR6;-;Axis Banking & PSU Debt Fund - Direct Plan - Growth Option;2897.1845;06-Aug-2026
149464;INF109KC1Y56;-;ICICI PRUDENTIAL SILVER ETF;223.4137;06-Aug-2026
garbage line that should be skipped
"""


def test_parse_indexes_both_isin_columns_and_names():
    table, last_date, names = parse_nav_table(NAV_TEXT)
    assert last_date == "2026-08-06"
    # growth ISIN column
    assert table["INF209KA12Z1"] == (107.0834, "2026-08-06")
    # reinvestment ISIN column (row 1 col 3)
    assert table["INF209KA13Z9"] == (107.0834, "2026-08-06")
    # '-'-only second ISIN must not pollute the table
    assert "INF209K01YN0" in table
    assert "-" not in table
    # scheme names captured (first wins per ISIN)
    assert names["INF209KA12Z1"] == "Aditya Birla Sun Life Banking & PSU Debt Fund  - DIRECT - IDCW"
    assert names["INF846K01CR6"] == "Axis Banking & PSU Debt Fund - Direct Plan - Growth Option"


def test_parse_ignores_section_headers_and_garbage():
    table, _, _ = parse_nav_table(NAV_TEXT)
    assert len(table) == 5
    assert all(isinstance(v[0], float) for v in table.values())


def test_parse_handles_unaudited_equals_prefix():
    """NAVAll.txt prefixes un-audited NAVs with '=' (e.g. some ETF schemes) -
    the value is still the NAV and must parse."""
    text = "x;INF204KB17I5;-;Nippon India ETF Gold BeES;=121.8414;06-Aug-2026\n"
    table, _, _ = parse_nav_table(text)
    assert table["INF204KB17I5"] == (121.8414, "2026-08-06")


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "t.db"
    migrate(path)
    return path


def _seed_mf_and_equity(conn) -> None:
    """CAS-derived MF + ETF + equity, plus a LIVE-leg ETF that must be untouched.

    The CAS rows mirror the REAL CAS shape: ticker == ISIN, instrument.isin is
    NULL (the CAS normalizer never populates isin) - the refresh must look up
    NAV by `isin or ticker` or every CAS scheme would be silently skipped.
    """
    # CAS: groww folio MF (with cost basis)
    acc_mf = writer.ensure_account(conn, "groww", account_ref="folio")
    inst_mf = writer.ensure_instrument(
        conn, "groww", "INF846K01CR6", isin=None,
        currency="INR", geography="IN", asset_class="mutual_fund",
    )
    writer.upsert_position(
        conn, acc_mf, inst_mf, quantity=100.0, avg_cost=50.0, price=100.0,
        cost_value_ccy=5000.0, market_value_ccy=10000.0, market_value_base=10000.0,
        cost_value_base=5000.0, updated_at="2026-08-06T00:00:00+00:00",
    )
    # CAS: groww demat ETF (asset_class='etf' - Indian ETFs are in NAVAll.txt)
    acc_etf = writer.ensure_account(conn, "groww", account_ref="")
    inst_etf = writer.ensure_instrument(
        conn, "groww", "INF109KC1Y56", isin=None,
        currency="INR", geography="IN", asset_class="etf",
    )
    writer.upsert_position(
        conn, acc_etf, inst_etf, quantity=10.0, avg_cost=None, price=200.0,
        cost_value_ccy=None, market_value_ccy=2000.0, market_value_base=2000.0,
        cost_value_base=None, updated_at="2026-08-06T00:00:00+00:00",
    )
    # CAS: sharekhan equity - in the CAS count but never priced (no AMFI NAV)
    acc_eq = writer.ensure_account(conn, "sharekhan")
    inst_eq = writer.ensure_instrument(
        conn, "sharekhan", "BAJFINANCE", isin="INE917I01010",
        currency="INR", geography="IN", asset_class="equity",
    )
    writer.upsert_position(
        conn, acc_eq, inst_eq, quantity=10.0, avg_cost=None, price=1004.75,
        cost_value_ccy=None, market_value_ccy=10047.5, market_value_base=10047.5,
        cost_value_base=None, updated_at="2026-08-06T00:00:00+00:00",
    )
    # LIVE leg: zerodha ETF (account_ref='') - fresh via its broker leg, must be
    # neither touched nor counted by the AMFI refresh.
    acc_live = writer.ensure_account(conn, "zerodha", account_ref="")
    inst_live = writer.ensure_instrument(
        conn, "zerodha", "NIFTYBEES", isin="INF204K01428",
        currency="INR", geography="IN", asset_class="etf",
    )
    writer.upsert_position(
        conn, acc_live, inst_live, quantity=50.0, avg_cost=None, price=555.5,
        cost_value_ccy=None, market_value_ccy=27775.0, market_value_base=27775.0,
        cost_value_base=None, updated_at="2026-08-07T00:00:00+00:00",
    )


def test_refresh_nav_prices_updates_mf_and_etf_skips_equities(db) -> None:
    reset_nav_cache()
    conn = connect(db)
    try:
        _seed_mf_and_equity(conn)
    finally:
        conn.close()

    summary = refresh_nav_prices(db, today="2026-08-07", fetch=lambda: NAV_TEXT)
    # 2 CAS schemes priced (MF + ETF); 1 CAS equity + 0 missing -> not_in_amfi=1.
    # The live zerodha ETF is not CAS-derived and is not counted at all.
    assert summary == "refreshed=2 | not_in_amfi=1"

    conn = connect(db)
    try:
        mf = conn.execute(
            "SELECT p.price, p.market_value_ccy, p.market_value_base,"
            " p.cost_value_ccy, p.avg_cost, p.cost_value_base"
            " FROM position p JOIN instrument i ON i.id = p.instrument_id"
            " WHERE i.ticker='INF846K01CR6'"
        ).fetchone()
        nav = 2897.1845
        assert mf["price"] == pytest.approx(nav)
        assert mf["market_value_ccy"] == pytest.approx(100.0 * nav)
        assert mf["market_value_base"] == pytest.approx(100.0 * nav)
        # cost fields untouched - returns stay computable
        assert mf["cost_value_ccy"] == pytest.approx(5000.0)
        assert mf["avg_cost"] == pytest.approx(50.0)
        assert mf["cost_value_base"] == pytest.approx(5000.0)

        # ETF-classified CAS scheme refreshes like a MF (Indian ETFs are in the feed)
        etf = conn.execute(
            "SELECT p.price, p.market_value_ccy FROM position p"
            " JOIN instrument i ON i.id = p.instrument_id"
            " WHERE i.ticker='INF109KC1Y56'"
        ).fetchone()
        assert etf["price"] == pytest.approx(223.4137)
        assert etf["market_value_ccy"] == pytest.approx(10.0 * 223.4137)

        # CAS equity: statement price kept
        eq = conn.execute(
            "SELECT p.price FROM position p JOIN instrument i ON i.id = p.instrument_id"
            " WHERE i.ticker='BAJFINANCE'"
        ).fetchone()
        assert eq["price"] == pytest.approx(1004.75)

        # LIVE leg: never touched by the AMFI refresh
        live = conn.execute(
            "SELECT p.price, p.updated_at FROM position p"
            " JOIN instrument i ON i.id = p.instrument_id"
            " WHERE i.ticker='NIFTYBEES'"
        ).fetchone()
        assert live["price"] == pytest.approx(555.5)
        assert live["updated_at"] == "2026-08-07T00:00:00+00:00"

        assert conn.execute(
            "SELECT COUNT(*) FROM price_history WHERE price_date='2026-08-06'"
        ).fetchone()[0] == 2
        assert conn.execute(
            "SELECT COUNT(*) FROM position_snapshot WHERE snapshot_date='2026-08-06'"
        ).fetchone()[0] == 2
        # F2: the ledger rows are dated with the NAV's OWN date from the feed
        # (06-Aug-2026), not the run's `today` (2026-08-07) - min(nav_date,
        # today) with a fallback to today when the feed has no date.
        newest = conn.execute(
            "SELECT ph.price_date FROM price_history ph"
            " JOIN instrument i ON i.id = ph.instrument_id"
            " WHERE i.ticker='INF846K01CR6'"
            " ORDER BY ph.price_date DESC LIMIT 1"
        ).fetchone()
        assert newest["price_date"] == "2026-08-06"
        run = conn.execute(
            "SELECT platform, status, rows, error FROM runs WHERE platform='amfi'"
        ).fetchone()
        assert run["status"] == "ok"
        assert run["rows"] == 2
    finally:
        conn.close()


def test_refresh_nav_prices_same_day_rerun_adds_no_duplicates(db) -> None:
    reset_nav_cache()
    conn = connect(db)
    try:
        _seed_mf_and_equity(conn)
    finally:
        conn.close()

    refresh_nav_prices(db, today="2026-08-07", fetch=lambda: NAV_TEXT)
    refresh_nav_prices(db, today="2026-08-07", fetch=lambda: NAV_TEXT)

    conn = connect(db)
    try:
        assert conn.execute("SELECT COUNT(*) FROM price_history").fetchone()[0] == 2
        assert conn.execute("SELECT COUNT(*) FROM position_snapshot").fetchone()[0] == 2
        assert conn.execute(
            "SELECT COUNT(*) FROM runs WHERE platform='amfi' AND status='ok'"
        ).fetchone()[0] == 2  # two runs logged, both idempotent on the ledger
    finally:
        conn.close()
