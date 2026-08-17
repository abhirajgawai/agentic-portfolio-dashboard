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
        " cost_value_ccy, market_value_ccy, market_value_base, updated_at)"
        " VALUES (1, 1, 10, 100, 120, 1000, 1200, 1200, '2026-08-17T06:00:00Z')"
    )
    conn.execute(
        "INSERT INTO position (account_id, instrument_id, quantity, avg_cost, price,"
        " cost_value_ccy, market_value_ccy, market_value_base, updated_at)"
        " VALUES (2, 2, 5, 80, 100, 400, 500, 500, '2026-08-17T06:00:00Z')"
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