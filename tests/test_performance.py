"""M8.6 daily performance engine tests: interval rule, attribution, rebuild.

The seed is a MIXED-FREQUENCY ledger that exercises every bucket of the
interval rule on purpose:

  - 06-30: groww CASFUND + real_estate TALOJA_PROPERTY first rows
           (both carry a 32-day gap to 08-01 -> revaluations, not day P&L)
  - 08-01: zerodha + moomoo first rows (first_appearance events), the CAS and
           property revaluations land here; dayPnlBase == 0 (nothing "moved")
  - 08-02: all four holdings have rows -> genuine daily moves (10, 166, 10,
           10000 in base) + broker day P&L (zerodha 10, moomoo 166)
  - 08-03: moomoo DROPS OUT (its "2 days" are over) - the honest
           mixed-frequency caveat: the per-date ledger identity
           valueBase(D) - valueBase(D-1) == dayPnl + revaluations holds only
           while the holding set is stable (asserted on 08-01/08-02 only)

Expected per-date facts (hand-computed, see the seed table below):

  date        valueBase   dayPnlBase   revaluations          broker
  2026-06-30  1,000,400   0            TALOJA +1,000,000, CASFUND +400 (first)
  2026-08-01  1,508,840   0            TALOJA +500,000 (property, 32d)
                                      SMH +8,300 / ZERODHA-1 +100 (first)
                                      CASFUND +40 (cas_import, 32d)
  2026-08-02  1,519,026   10,186       -                      {zerodha 10, moomoo 166}
  2026-08-03  1,505,805   -5,005       NEWHOLD +250 (first)   {zerodha -5}

Simple return (cost-bearing rows only): 06-30 11.11%, 08-01 66.11%,
08-02 67.23%, 08-03 67.20%. costCoverage {with, no}: 06-30 {1,1}, then {3,1}.

Scope rows in the table: 7 + 12 + 12 + 10 = 41 (one per (date, scope_type,
scope_key) for all|geography|platform|asset_class|currency).
"""

from __future__ import annotations

from datetime import datetime

import pytest

from portfolio.db import connect, writer
from portfolio.db.migrate import migrate
from portfolio.performance import REVAL_GAP_DAYS, daily_performance, rebuild_table


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "t.db"
    migrate(path)
    return path


@pytest.fixture()
def seeded(db):
    """Migrated DB with the mixed-frequency ledger written ONCE (the seed rows
    carry fixed run started_at values, so re-seeding would violate
    UNIQUE(platform, started_at) - seed per test, not per payload call)."""
    conn = connect(db)
    try:
        _seed(conn)
    finally:
        conn.close()
    return db


# (day, platform, ticker, geo, ccy, asset_class, mkt_ccy, mkt_base, cost_base, dccy)
_SEED = [
    ("2026-06-30", "groww", "CASFUND", "IN", "INR", "mutual_fund", 400.0, 400.0, None, None),
    ("2026-06-30", "real_estate", "TALOJA_PROPERTY", "IN", "INR", "real_estate", 1_000_000.0, 1_000_000.0, 900_000.0, None),
    ("2026-08-01", "zerodha", "ZERODHA-1", "IN", "INR", "equity", 100.0, 100.0, 100.0, None),
    ("2026-08-01", "moomoo", "SMH", "US", "USD", "equity", 100.0, 8300.0, 8000.0, None),
    ("2026-08-01", "groww", "CASFUND", "IN", "INR", "mutual_fund", 440.0, 440.0, None, None),
    ("2026-08-01", "real_estate", "TALOJA_PROPERTY", "IN", "INR", "real_estate", 1_500_000.0, 1_500_000.0, 900_000.0, None),
    ("2026-08-02", "zerodha", "ZERODHA-1", "IN", "INR", "equity", 110.0, 110.0, 100.0, 10.0),
    ("2026-08-02", "moomoo", "SMH", "US", "USD", "equity", 102.0, 8466.0, 8000.0, 2.0),
    ("2026-08-02", "groww", "CASFUND", "IN", "INR", "mutual_fund", 450.0, 450.0, None, None),
    ("2026-08-02", "real_estate", "TALOJA_PROPERTY", "IN", "INR", "real_estate", 1_510_000.0, 1_510_000.0, 900_000.0, None),
    ("2026-08-03", "zerodha", "ZERODHA-1", "IN", "INR", "equity", 105.0, 105.0, 100.0, -5.0),
    ("2026-08-03", "groww", "CASFUND", "IN", "INR", "mutual_fund", 450.0, 450.0, None, None),
    ("2026-08-03", "real_estate", "TALOJA_PROPERTY", "IN", "INR", "real_estate", 1_505_000.0, 1_505_000.0, 900_000.0, None),
    ("2026-08-03", "sharekhan", "NEWHOLD", "IN", "INR", "equity", 250.0, 250.0, 250.0, None),
]

EXPECTED_DATES = ["2026-06-30", "2026-08-01", "2026-08-02", "2026-08-03"]
EXPECTED_VALUE = [1_000_400.0, 1_508_840.0, 1_519_026.0, 1_505_805.0]
EXPECTED_DAY_PNL = [0.0, 0.0, 10_186.0, -5_005.0]
EXPECTED_COVERAGE = [{"withCost": 1, "noCost": 1}, {"withCost": 3, "noCost": 1},
                     {"withCost": 3, "noCost": 1}, {"withCost": 3, "noCost": 1}]
EXPECTED_BROKER = [{}, {}, {"moomoo": 166.0, "zerodha": 10.0}, {"zerodha": -5.0}]


def _seed(conn) -> None:
    for i, (day, platform, ticker, geo, ccy, ac, mv_ccy, mv_base, cost_base, dccy) in enumerate(_SEED):
        run_id = writer.write_run(
            conn, platform, day, f"run-{i}-{platform}-{ticker}", "ok", rows=1, is_eod=True
        )
        acc = writer.ensure_account(
            conn, platform, account_ref=f"ACC-{platform}",
            base_currency="INR" if geo == "IN" else "SGD",
        )
        inst = writer.ensure_instrument(
            conn, platform, ticker, currency=ccy, geography=geo,
            name=f"{ticker} Name", asset_class=ac,
        )
        writer.upsert_position_snapshot(
            conn, run_id, acc, inst, None, day,
            quantity=1.0, avg_cost=cost_base, price=mv_base,
            cost_value_ccy=cost_base, market_value_ccy=mv_ccy,
            market_value_base=mv_base, cost_value_base=cost_base,
            day_change_ccy=dccy,
        )


def _payload(path) -> dict:
    conn = connect(path)
    try:
        return daily_performance(conn, today="2026-08-03")
    finally:
        conn.close()


def _by_date(entries: list[dict]) -> dict[str, dict]:
    return {e["date"]: e for e in entries}


# ---- interval rule: revaluations vs day P&L -----------------------------------


def test_revaluations_never_in_day_pnl(seeded):
    """The 32-day CAS/property gaps and first appearances land in
    revaluationEvents, never in dayPnlBase or attribution."""
    daily = _by_date(_payload(seeded)["daily"])

    # 08-01: everything that changed was a revaluation/first appearance.
    assert daily["2026-08-01"]["dayPnlBase"] == 0.0
    reval = daily["2026-08-01"]["revaluationEvents"]
    assert [e["ticker"] for e in reval] == ["TALOJA_PROPERTY", "SMH", "ZERODHA-1", "CASFUND"]
    by_ticker = {e["ticker"]: e for e in reval}
    assert by_ticker["TALOJA_PROPERTY"]["kind"] == "property"
    assert by_ticker["TALOJA_PROPERTY"]["changeBase"] == pytest.approx(500_000.0)
    assert by_ticker["TALOJA_PROPERTY"]["intervalDays"] == 32
    assert by_ticker["CASFUND"]["kind"] == "cas_import"
    assert by_ticker["CASFUND"]["changeBase"] == pytest.approx(40.0)
    assert by_ticker["CASFUND"]["intervalDays"] == 32
    # 06-30: first rows are first_appearance revaluations (the whole value).
    reval30 = daily["2026-06-30"]["revaluationEvents"]
    assert [e["ticker"] for e in reval30] == ["TALOJA_PROPERTY", "CASFUND"]
    assert all(e["kind"] == "first_appearance" and e["intervalDays"] is None for e in reval30)
    assert daily["2026-06-30"]["dayPnlBase"] == 0.0

    # The day series (daily moves) is the value DELTA for the ≤7-day legs:
    # 08-02 = 10 + 166 + 10 + 10000; 08-03 = -5 + 0 + -5000 (CASFUND flat,
    # NEWHOLD is a first appearance -> excluded).
    assert [e["dayPnlBase"] for e in _payload(seeded)["daily"]] == EXPECTED_DAY_PNL


def test_first_appearance_is_revaluation_not_day_pnl(seeded):
    """NEWHOLD first appears on 08-03: its 250 is a revaluation event; the day
    P&L and the top movers do NOT contain it."""
    daily = _by_date(_payload(seeded)["daily"])
    d3 = daily["2026-08-03"]
    assert [e["ticker"] for e in d3["revaluationEvents"]] == ["NEWHOLD"]
    assert d3["revaluationEvents"][0]["kind"] == "first_appearance"
    assert d3["revaluationEvents"][0]["intervalDays"] is None
    assert all(m["ticker"] != "NEWHOLD" for m in d3["topMovers"])
    # Attribution holds only the daily moves: -5000 (property) + -5 (zerodha).
    assert d3["attribution"]["byAssetClass"]["real_estate"] == pytest.approx(-5000.0)
    assert d3["attribution"]["byAssetClass"].get("equity") == pytest.approx(-5.0)


def test_gap_boundary_is_seven_days(db):
    """REVAL_GAP_DAYS pins the bucket boundary: gap == 7 is a daily move."""
    assert REVAL_GAP_DAYS == 7


# ---- reconciliation invariants -------------------------------------------------


def test_attribution_reconciliation_invariant(seeded):
    """M3.5 rule: per date, dayPnlBase == sum(byGeography) == sum(byPlatform)
    == sum(byAssetClass) - each dimension partitions the same daily moves."""
    for entry in _payload(seeded)["daily"]:
        sums = [
            sum(entry["attribution"][dim].values())
            for dim in ("byGeography", "byPlatform", "byAssetClass")
        ]
        for s in sums:
            assert entry["dayPnlBase"] == pytest.approx(s, abs=0.01)
    # The 08-02 split is hand-pinned: IN 10020 (10+10+10000), US 166.
    d2 = _by_date(_payload(seeded)["daily"])["2026-08-02"]
    assert d2["attribution"]["byGeography"] == {"IN": pytest.approx(10020.0), "US": pytest.approx(166.0)}
    assert d2["attribution"]["byPlatform"] == {
        "groww": pytest.approx(10.0), "moomoo": pytest.approx(166.0),
        "real_estate": pytest.approx(10000.0), "zerodha": pytest.approx(10.0),
    }
    assert d2["attribution"]["byAssetClass"] == {
        "equity": pytest.approx(176.0), "mutual_fund": pytest.approx(10.0),
        "real_estate": pytest.approx(10000.0),
    }


def test_ledger_identity_value_delta(seeded):
    """valueBase(D) - valueBase(D-1) == dayPnlBase(D) + sum(revaluationEvents).

    Holds on 08-01/08-02 where the holding set is stable between consecutive
    ledger dates. 08-03 is deliberately NOT asserted: moomoo drops out (its
    "2 days" end), so the base series and the P&L series measure different
    holding sets - the honest mixed-frequency caveat documented in the module.
    """
    daily = _payload(seeded)["daily"]
    values = {e["date"]: e["valueBase"] for e in daily}
    for idx in (1, 2):  # 08-01, 08-02
        entry = daily[idx]
        prev = daily[idx - 1]
        lhs = values[entry["date"]] - values[prev["date"]]
        rhs = entry["dayPnlBase"] + sum(e["changeBase"] for e in entry["revaluationEvents"])
        assert lhs == pytest.approx(rhs, abs=0.01)


# ---- broker day P&L -------------------------------------------------------------


def test_broker_day_pnl_only_live_legs(seeded):
    """brokerDayPnl comes from day_change_ccy (live legs only): zerodha/moomoo
    present, groww/real_estate absent. Conversion uses the row's own frozen
    value ratio (moomoo: 2.0 * 8466/102 = 166.0)."""
    daily = _by_date(_payload(seeded)["daily"])
    for entry in daily.values():
        assert "groww" not in entry["brokerDayPnl"]
        assert "real_estate" not in entry["brokerDayPnl"]
    assert daily["2026-08-02"]["brokerDayPnl"] == {"moomoo": 166.0, "zerodha": 10.0}
    assert daily["2026-08-03"]["brokerDayPnl"] == {"zerodha": -5.0}
    assert daily["2026-08-01"]["brokerDayPnl"] == {}
    assert daily["2026-06-30"]["brokerDayPnl"] == {}


# ---- simple returns + cost coverage --------------------------------------------


def test_simple_return_and_cost_coverage(seeded):
    """(sum value - sum cost) / sum cost over COST-BEARING rows only; the
    value-only CAS rows (NULL cost) are excluded from the ratio but counted in
    costCoverage.noCost."""
    daily = _by_date(_payload(seeded)["daily"])
    for i, entry in enumerate(_payload(seeded)["daily"]):
        assert entry["costCoverage"] == EXPECTED_COVERAGE[i]
    # The payload rounds to 2dp, so expected values are rounded too.
    assert daily["2026-06-30"]["simpleReturnPct"] == pytest.approx(
        round((1_000_000 - 900_000) / 900_000 * 100, 2)
    )
    assert daily["2026-08-01"]["simpleReturnPct"] == pytest.approx(
        round((100 + 8300 + 1_500_000 - (100 + 8000 + 900_000)) / (100 + 8000 + 900_000) * 100, 2)
    )
    assert daily["2026-08-03"]["simpleReturnPct"] == pytest.approx(
        round((105 + 1_505_000 + 250 - (100 + 900_000 + 250)) / (100 + 900_000 + 250) * 100, 2)
    )


def test_simple_return_none_without_cost_rows(db):
    """A day with no cost-bearing rows: simpleReturnPct None, noCost counts
    them - never a crash."""
    conn = connect(db)
    try:
        run_id = writer.write_run(conn, "groww", "2026-08-01", "run-0", "ok", rows=1, is_eod=True)
        acc = writer.ensure_account(conn, "groww", account_ref="ACC-groww")
        inst = writer.ensure_instrument(conn, "groww", "NOCOST", currency="INR", geography="IN")
        writer.upsert_position_snapshot(
            conn, run_id, acc, inst, None, "2026-08-01",
            quantity=1.0, avg_cost=None, price=500.0,
            cost_value_ccy=None, market_value_ccy=500.0,
            market_value_base=500.0, cost_value_base=None,
        )
        payload = daily_performance(conn, today="2026-08-01")
    finally:
        conn.close()
    assert payload["daily"][0]["simpleReturnPct"] is None
    assert payload["daily"][0]["costCoverage"] == {"withCost": 0, "noCost": 1}


# ---- determinism ---------------------------------------------------------------


def test_determinism_two_calls_identical(seeded):
    first = _payload(seeded)
    second = _payload(seeded)
    assert first == second
    # Sorted keys + dates + mover/reval ordering are structural determinism.
    daily = _by_date(first["daily"])
    for entry in first["daily"]:
        for dim in ("byGeography", "byPlatform", "byAssetClass"):
            assert list(entry["attribution"][dim].keys()) == sorted(entry["attribution"][dim])
    assert [e["date"] for e in first["daily"]] == sorted(e["date"] for e in first["daily"])
    # 08-02 top movers: |10000|, |166|, then the |10| tie sorted by ticker.
    movers = daily["2026-08-02"]["topMovers"]
    assert [m["ticker"] for m in movers] == ["TALOJA_PROPERTY", "SMH", "CASFUND", "ZERODHA-1"]
    assert movers[0]["dayPnlBase"] == pytest.approx(10000.0)


# ---- table rebuild -------------------------------------------------------------


def test_rebuild_table_rows_and_idempotency(seeded):
    payload = _payload(seeded)
    conn = connect(seeded)
    try:
        n = rebuild_table(conn, payload, rebuilt_at="2026-08-03T20:00:00+00:00")
        assert n == 41  # 7 + 12 + 12 + 10 scope rows over the four dates
        assert conn.execute("SELECT COUNT(*) FROM daily_performance").fetchone()[0] == 41
        distinct = conn.execute(
            "SELECT COUNT(*) FROM (SELECT DISTINCT perf_date, scope_type, scope_key"
            " FROM daily_performance)"
        ).fetchone()[0]
        assert distinct == 41  # UNIQUE key: no dupes
        # Spot-check the 'all' row for 08-02 and the platform scope broker.
        row = conn.execute(
            "SELECT value_base, day_pnl_base, broker_day_pnl_base, day_pnl_pct,"
            " simple_return_pct, cost_with, cost_without FROM daily_performance"
            " WHERE perf_date='2026-08-02' AND scope_type='all' AND scope_key=''"
        ).fetchone()
        assert row["value_base"] == pytest.approx(1_519_026.0)
        assert row["day_pnl_base"] == pytest.approx(10_186.0)
        assert row["broker_day_pnl_base"] == pytest.approx(176.0)
        assert row["cost_with"] == 3 and row["cost_without"] == 1
        plat = conn.execute(
            "SELECT day_pnl_base, broker_day_pnl_base FROM daily_performance"
            " WHERE perf_date='2026-08-02' AND scope_type='platform' AND scope_key='moomoo'"
        ).fetchone()
        assert plat["day_pnl_base"] == pytest.approx(166.0)
        assert plat["broker_day_pnl_base"] == pytest.approx(166.0)
        # groww rows carry no broker P&L -> NULL column, not 0.0.
        groww = conn.execute(
            "SELECT broker_day_pnl_base FROM daily_performance"
            " WHERE perf_date='2026-08-02' AND scope_type='platform' AND scope_key='groww'"
        ).fetchone()
        assert groww["broker_day_pnl_base"] is None
        # The scope day_pnl values reconcile with the payload attribution.
        rows = conn.execute(
            "SELECT scope_key, day_pnl_base FROM daily_performance"
            " WHERE perf_date='2026-08-02' AND scope_type='asset_class'"
        ).fetchall()
        assert {r["scope_key"]: r["day_pnl_base"] for r in rows} == pytest.approx(
            {"equity": 176.0, "mutual_fund": 10.0, "real_estate": 10000.0}
        )

        # Idempotent: a second rebuild writes the same rows (DELETE-first).
        n2 = rebuild_table(conn, payload, rebuilt_at="2026-08-03T21:00:00+00:00")
        assert n2 == 41
        assert conn.execute("SELECT COUNT(*) FROM daily_performance").fetchone()[0] == 41
        assert conn.execute(
            "SELECT COUNT(*) FROM (SELECT DISTINCT perf_date, scope_type, scope_key"
            " FROM daily_performance)"
        ).fetchone()[0] == 41
    finally:
        conn.close()


def test_rebuild_table_requires_engine_payload(db):
    conn = connect(db)
    try:
        with pytest.raises(ValueError):
            rebuild_table(conn, {"daily": []}, rebuilt_at="2026-08-03T00:00:00+00:00")
    finally:
        conn.close()


# ---- empty / malformed inputs ---------------------------------------------------


def test_empty_db_returns_valid_payload(db):
    """A fresh (migrated, unseeded) DB: empty daily list, valid payload - the
    engine must not crash on no data."""
    conn = connect(db)
    try:
        payload = daily_performance(conn, today="2026-08-03")
    finally:
        conn.close()
    assert payload["daily"] == []
    assert payload["xirr"] == {"asOf": "2026-08-03", "perAccount": {}}
    assert payload["_scopes"] == []


def test_malformed_today_degrades_to_missing(db):
    """A garbage `today` behaves as missing data - empty payload, never a crash."""
    conn = connect(db)
    try:
        payload = daily_performance(conn, today="not-a-date")
    finally:
        conn.close()
    assert payload["daily"] == []
    assert payload["_scopes"] == []


def test_naive_datetime_refused(db):
    """The determinism boundary: a naive `today` (no timezone) is refused
    loudly - a naive clock would silently shift market dates."""
    conn = connect(db)
    try:
        _seed(conn)
        with pytest.raises(ValueError):
            daily_performance(conn, today=datetime(2026, 8, 3, 20, 0))  # naive
    finally:
        conn.close()


# ---- migration ------------------------------------------------------------------


def test_migration_fresh_db_reaches_v10(db):
    conn = connect(db)
    try:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 10
        assert conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='daily_performance'"
        ).fetchone()[0] == 1
    finally:
        conn.close()
