"""portfolio_data_mcp tool tests: read-only contract + output shapes.

Guards the M7 data-shape contract against a scratch DB (the same tables the
eval's questions read): every tool is SELECT-only, takes bounded inputs, and
returns the documented JSON shape. The read-only connection is exercised too:
a WRITE attempt on the same connection must fail (SQLite mode=ro).
"""

from __future__ import annotations

import sqlite3

import portfolio_data_mcp.server as server
import pytest

from portfolio.db import connect
from portfolio.db.migrate import migrate


@pytest.fixture()
def db(tmp_path, monkeypatch):
    """A migrated scratch DB seeded with minimal positions/runs/alerts."""
    path = tmp_path / "portfolio_test.db"
    migrate(path)
    conn = connect(path)
    conn.execute("INSERT INTO account (platform, label, base_currency) VALUES ('zerodha', 'z', 'INR')")
    conn.execute("INSERT INTO account (platform, label, base_currency) VALUES ('moomoo', 'm', 'INR')")
    conn.execute(
        "INSERT INTO instrument (platform, ticker, name, geography, currency, sector, asset_class)"
        " VALUES ('zerodha', 'INFY', 'Infosys', 'IN', 'INR', 'IT', 'equity')"
    )
    conn.execute(
        "INSERT INTO instrument (platform, ticker, name, geography, currency, sector, asset_class)"
        " VALUES ('moomoo', 'MU', 'Micron', 'US', 'USD', 'Semiconductors', 'equity')"
    )
    conn.execute(
        "INSERT INTO position (account_id, instrument_id, quantity, avg_cost, price,"
        " cost_value_ccy, market_value_ccy, market_value_base, cost_value_base, updated_at)"
        " VALUES (1, 1, 10, 100, 120, 1000, 1200, 1200, 1000, '2026-08-17T06:00:00Z')"
    )
    conn.execute(
        "INSERT INTO position (account_id, instrument_id, quantity, avg_cost, price,"
        " cost_value_ccy, market_value_ccy, market_value_base, cost_value_base, updated_at)"
        " VALUES (2, 2, 5, 80, 100, 400, 500, 500, 400, '2026-08-17T06:00:00Z')"
    )
    conn.execute("INSERT INTO runs (platform, started_at, status, error) VALUES ('zerodha', '2026-08-17T06:00:00Z', 'ok', NULL)")
    conn.execute("INSERT INTO runs (platform, started_at, status, error) VALUES ('moomoo', '2026-08-17T06:00:01Z', 'error', 'login please')")
    conn.execute(
        "INSERT INTO position_snapshot (account_id, instrument_id, snapshot_date, quantity, price,"
        " market_value_ccy, market_value_base) VALUES (1, 1, '2026-08-17', 10, 120, 1200, 1200)"
    )
    conn.execute(
        "INSERT INTO position_snapshot (account_id, instrument_id, snapshot_date, quantity, price,"
        " market_value_ccy, market_value_base) VALUES (2, 2, '2026-08-17', 5, 100, 500, 500)"
    )
    conn.execute("INSERT INTO alert_events (rule_id, event_date, severity, message, created_at)"
                 " VALUES ('holding_deep_loss', '2026-08-17', 'warn', 'KPITTECH -45%', '2026-08-17T06:00:00Z')")
    conn.commit()
    conn.close()
    monkeypatch.setattr(server, "DB_PATH", path)
    return path


def test_latest_snapshot_shape_and_filters(db):
    snap = server.latest_snapshot()
    assert snap["count"] == 2
    assert {h["ticker"] for h in snap["holdings"]} == {"INFY", "MU"}
    first = snap["holdings"][0]  # value-descending: INFY 1200 > MU 500
    assert first["ticker"] == "INFY"
    assert first["platform"] == "zerodha" and first["geography"] == "IN"
    assert first["sector"] == "IT" and first["asset_class"] == "equity"

    assert server.latest_snapshot(platform="moomoo")["count"] == 1
    assert server.latest_snapshot(ticker="mu")["holdings"][0]["ticker"] == "MU"
    assert server.latest_snapshot(sector="semiconductors")["count"] == 1
    assert server.latest_snapshot(limit=1)["count"] == 1


def test_allocation_summary_sums_to_100(db):
    alloc = server.allocation_summary()
    assert alloc["totalBase"] == pytest.approx(1700.0)
    assert alloc["holdingsCount"] == 2
    assert alloc["byGeography"]["IN"]["pct"] == pytest.approx(70.59, abs=0.01)
    by_geo = sum(b["pct"] for b in alloc["byGeography"].values())
    assert by_geo == pytest.approx(100.0)
    assert sum(b["pct"] for b in alloc["byPlatform"].values()) == pytest.approx(100.0)


def test_holding_history_series(db):
    hist = server.holding_history("mu")
    assert hist["ticker"] == "MU" and hist["count"] == 1
    assert hist["points"][0]["snapshot_date"] == "2026-08-17"
    assert server.holding_history("")["error"]  # ticker required


def test_portfolio_total_and_runs_and_alerts(db):
    total = server.portfolio_total()
    assert total["totalBase"] == pytest.approx(1700.0)
    assert total["byPlatform"]["zerodha"] == pytest.approx(1200.0)
    runs = server.recent_runs(limit=10)
    assert [r["status"] for r in runs["runs"]] == ["error", "ok"]
    assert runs["runs"][0]["error"] == "login please"
    alerts = server.fired_alerts()
    assert alerts["alerts"][0]["rule_id"] == "holding_deep_loss"
    assert server.fired_alerts(severity="critical")["count"] == 0
    assert server.fired_alerts(severity="bogus")["error"]


def test_bounded_inputs_and_errors(db):
    assert server.latest_snapshot(platform="nope")["error"]
    assert server.latest_snapshot(limit=99_999)["count"] <= 500


def test_connection_is_read_only(db):
    """The SQLite connection refuses writes - the filesystem-level lock."""
    conn = server._connect()
    try:
        with pytest.raises(sqlite3.OperationalError):
            conn.execute("INSERT INTO runs (platform, started_at, status) VALUES ('x', 'y', 'z')")
    finally:
        conn.close()


def test_holding_returns_best_first_costless_last(db):
    """holding_returns: export_json's return formula, best-first, costless last.

    The shared fixture seeds two COST-BEARING positions (INFY cost 1000 ->
    +20.00%, MU cost 400 -> +25.00%; hand-computed from the export_json
    formula (market_value_base - cost_value_base)/cost_value_base * 100).
    This test adds a THIRD, COSTLESS position (groww MF, cost_value_base
    NULL) inside the test only, so the shared fixture's counts (2 holdings,
    totalBase 1700) that earlier tests assert are untouched.
    """
    conn = connect(db)
    conn.execute("INSERT INTO account (platform, label, base_currency) VALUES ('groww', 'g', 'INR')")
    conn.execute(
        "INSERT INTO instrument (platform, ticker, name, geography, currency, sector, asset_class)"
        " VALUES ('groww', 'HDFCBAL', 'HDFC Balanced Advantage', 'IN', 'INR', 'Mutual Fund', 'mutual_fund')"
    )
    conn.execute(
        "INSERT INTO position (account_id, instrument_id, quantity, avg_cost, price,"
        " cost_value_ccy, market_value_ccy, market_value_base, updated_at)"
        " VALUES (3, 3, 10, NULL, 60, 600, 600, 600, '2026-08-17T06:00:00Z')"
    )
    conn.commit()
    conn.close()

    rr = server.holding_returns()
    assert rr["count"] == 3
    assert rr["withCost"] == 2
    assert rr["noCost"] == 1

    # Best first (MU +25 > INFY +20), costless row LAST with returnPct null.
    best, second, costless = rr["holdings"]
    assert (best["ticker"], best["returnPct"]) == ("MU", pytest.approx(25.00))
    assert (second["ticker"], second["returnPct"]) == ("INFY", pytest.approx(20.00))
    assert costless["ticker"] == "HDFCBAL"
    assert costless["returnPct"] is None
    assert costless["costValueBase"] is None
    # Envelope carries the cost basis the agent needs to explain the number.
    assert best["costValueBase"] == pytest.approx(400.0)
    assert best["marketValueBase"] == pytest.approx(500.0)
    assert "updated_at" in best and "sector" in best and "asset_class" in best

    # The best performer survives a limit of 1 (sort happens before slicing).
    assert [h["ticker"] for h in server.holding_returns(limit=1)["holdings"]] == ["MU"]

    # Filters: asset_class (best MF vs best stock), platform, ticker.
    eq = server.holding_returns(asset_class="equity")
    assert eq["count"] == 2 and eq["withCost"] == 2 and eq["noCost"] == 0
    assert {h["ticker"] for h in eq["holdings"]} == {"INFY", "MU"}
    mf = server.holding_returns(asset_class="MUTUAL_FUND")  # case-insensitive
    assert mf["count"] == 1 and mf["holdings"][0]["ticker"] == "HDFCBAL"
    assert mf["holdings"][0]["returnPct"] is None
    assert server.holding_returns(platform="groww")["count"] == 1
    infy = server.holding_returns(ticker="INFY")
    assert infy["count"] == 1 and infy["holdings"][0]["returnPct"] == pytest.approx(20.00)

    # Bogus asset_class matches nothing (graceful empty, never a crash)...
    empty = server.holding_returns(asset_class="bogus")
    assert empty["count"] == 0 and empty["withCost"] == 0 and empty["noCost"] == 0
    assert "error" not in empty
    # ...and a bogus platform still returns the structured error dict.
    assert server.holding_returns(platform="nope")["error"]


# ---------------------------------------------------------------------------
# daily_performance (M8.6): the rebuilt ledger over (perf_date, scope_type,
# scope_key). The shared `db` fixture runs migrate() (v10 now includes 0010),
# so the table exists there; the table-missing case gets its own old-schema DB.
# ---------------------------------------------------------------------------

# Insert statement matching the migration 0010 columns, in table order
# (fx_rate_id is nullable and left NULL - value_base is already in base ccy).
_PERF_INSERT = (
    "INSERT INTO daily_performance (perf_date, scope_type, scope_key, value_base,"
    " day_pnl_base, broker_day_pnl_base, day_pnl_pct, simple_return_pct,"
    " cost_with, cost_without, rebuilt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)
# perf_date, scope_type, scope_key, value_base, day_pnl_base,
# broker_day_pnl_base, day_pnl_pct, simple_return_pct, cost_with, cost_without,
# rebuilt_at - UNIQUE (perf_date, scope_type, scope_key) respected.
_PERF_ROWS = [
    ("2026-08-10", "all", "", 6600000.0, -25000.0, None, -0.38, 46.0, 48, 20, "2026-08-18T06:00:00Z"),
    ("2026-08-11", "all", "", 6620000.0, 20000.0, None, 0.3, 46.4, 48, 20, "2026-08-18T06:00:00Z"),
    ("2026-08-10", "geography", "IN", 4800000.0, -12000.0, None, -0.25, 44.0, 30, 12, "2026-08-18T06:00:00Z"),
    ("2026-08-10", "geography", "US", 1800000.0, -13000.0, -13000.0, -0.72, 51.0, 18, 8, "2026-08-18T06:00:00Z"),
    ("2026-08-11", "geography", "US", 1820000.0, 18000.0, 18000.0, 1.0, 52.0, 18, 8, "2026-08-18T06:00:00Z"),
    ("2026-08-10", "platform", "zerodha", 4300000.0, -10000.0, -10000.0, -0.23, 43.0, 30, 5, "2026-08-18T06:00:00Z"),
    ("2026-08-10", "asset_class", "equity", 5800000.0, -21000.0, None, -0.36, 47.0, 40, 8, "2026-08-18T06:00:00Z"),
    ("2026-08-11", "currency", "INR", 6620000.0, 20000.0, None, 0.3, 46.4, 48, 20, "2026-08-18T06:00:00Z"),
]


def _seed_perf(db_path) -> None:
    conn = connect(db_path)
    for row in _PERF_ROWS:
        conn.execute(_PERF_INSERT, row)
    conn.commit()
    conn.close()


def test_daily_performance_filters_order_and_rounding(db):
    """Rows come back date/scope-ordered, rounded to 2dp, filters exact."""
    _seed_perf(db)

    out = server.daily_performance()
    assert out["note"] is None and out["count"] == len(_PERF_ROWS)
    keys = [(r["perf_date"], r["scope_type"], r["scope_key"]) for r in out["rows"]]
    assert keys == sorted(keys)  # ORDER BY (perf_date, scope_type, scope_key)
    first = out["rows"][0]
    assert set(first) == {
        "perf_date", "scope_type", "scope_key", "value_base", "day_pnl_base",
        "broker_day_pnl_base", "day_pnl_pct", "simple_return_pct",
        "cost_with", "cost_without", "rebuilt_at",
    }
    assert first["value_base"] == pytest.approx(6600000.0)
    assert first["cost_with"] == 48 and first["cost_without"] == 20
    assert first["rebuilt_at"] == "2026-08-18T06:00:00Z"
    assert first["broker_day_pnl_base"] is None  # 'all' scope has no broker P&L

    # Two-sided inclusive date window: 5 of the 8 rows fall on 08-10.
    win = server.daily_performance(date_from="2026-08-10", date_to="2026-08-10")
    assert win["count"] == 5
    assert {r["perf_date"] for r in win["rows"]} == {"2026-08-10"}
    # One-sided ranges work too (BETWEEN semantics extended to >= / <=).
    assert server.daily_performance(date_from="2026-08-11")["count"] == 3
    assert server.daily_performance(date_to="2026-08-10")["count"] == 5

    # scope_type filter (case-insensitive input), scope_key case-insensitive.
    geo = server.daily_performance(scope_type="GEOGRAPHY")
    assert geo["count"] == 3 and {r["scope_key"] for r in geo["rows"]} == {"IN", "US"}
    us = server.daily_performance(scope_type="geography", scope_key="us")
    assert us["count"] == 2 and all(r["scope_key"] == "US" for r in us["rows"])
    assert us["rows"][0]["broker_day_pnl_base"] == pytest.approx(-13000.0)
    assert us["rows"][0]["day_pnl_pct"] == pytest.approx(-0.72)  # 2dp rounding
    assert us["rows"][1]["day_pnl_pct"] == pytest.approx(1.0)
    # Combined date + scope filter (the "what drove the drop" query shape).
    drop = server.daily_performance(
        date_from="2026-08-10", date_to="2026-08-10", scope_type="platform"
    )
    assert drop["count"] == 1 and drop["rows"][0]["scope_key"] == "zerodha"
    assert drop["rows"][0]["day_pnl_base"] == pytest.approx(-10000.0)


def test_daily_performance_invalid_inputs_and_limit_clamp(db):
    _seed_perf(db)

    # Unknown scope_type -> structured error, never an empty success.
    err = server.daily_performance(scope_type="instrument")
    assert err["error"] and err["count"] == 0
    assert "instrument" in err["error"] and "expected one of" in err["error"]
    # Malformed dates are rejected before they reach SQL.
    assert server.daily_performance(date_from="10-08-2026")["error"]
    assert server.daily_performance(date_to="not-a-date")["error"]

    # limit clamped to [1, 500]; garbage -> default (100).
    assert server.daily_performance(limit=2)["count"] == 2
    assert server.daily_performance(limit=999_999)["count"] == len(_PERF_ROWS)
    assert server.daily_performance(limit="bogus")["count"] == len(_PERF_ROWS)


def test_daily_performance_missing_table_graceful(tmp_path, monkeypatch):
    """A pre-0010 schema (no daily_performance): empty envelope + note, no crash.

    Builds a genuine v9 DB by applying migrations 0001..0009 only (the same
    scripts migrate() would run) - the table the tool reads simply is not
    there yet, exactly like a fresh DB before the parallel worker's migration
    lands. Uses `_discover` (same discovery migrate() uses) so a future 0011
    does not leak into this old-schema fixture.
    """
    from portfolio.db.migrate import _discover

    path = tmp_path / "pre_0010.db"
    conn = connect(path)
    for version, sql_path in sorted(_discover()):
        if version >= 10:
            continue
        conn.executescript(sql_path.read_text(encoding="utf-8"))
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 9
    conn.close()
    monkeypatch.setattr(server, "DB_PATH", path)

    out = server.daily_performance()
    assert out == {
        "rows": [],
        "count": 0,
        "note": "daily_performance table not available yet (migration 0010)",
    }
    # Filtered calls degrade the same way - never a crash, never partial rows.
    filtered = server.daily_performance(date_from="2026-08-01", scope_type="geography")
    assert filtered["rows"] == [] and filtered["count"] == 0
    assert "not available yet" in filtered["note"]