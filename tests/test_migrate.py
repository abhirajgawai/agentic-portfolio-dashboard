"""Migration framework: versioned apply + the v1 -> v2 data-preserving backfill."""

from __future__ import annotations

import sqlite3

from portfolio.db import connect
from portfolio.db.migrate import MIGRATIONS_DIR, migrate

V1_FILE = MIGRATIONS_DIR / "0001_v1_initial.sql"


def _insert_run(conn: sqlite3.Connection, started_at: str) -> None:
    conn.execute(
        "INSERT INTO runs (platform, started_at, status, rows) VALUES (?,?,?,?)",
        ("zerodha", started_at, "ok", 1),
    )


def _tables(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def test_fresh_migrate_creates_v11_schema(tmp_path) -> None:
    path = tmp_path / "t.db"
    assert migrate(path) == 12
    conn = connect(path)
    assert {
        "account", "instrument", "fx_rate", "price_history",
        "position", "position_snapshot", "portfolio_value", "trade", "runs", "account_funds",
        "alert_events",  # v6 (M6): rule-alert dedupe backbone
        "daily_performance",  # v10 (M8.6): materialized daily performance scopes
        "goal",  # v11 (M8.9): savings goals out of localStorage
        "cas_schedule",  # v12: CAMS+KFintech CAS request schedule
    } <= _tables(conn)
    assert {"snapshots", "fx_rates", "trades"} & _tables(conn) == set()
    # v3 adds cost basis in base currency; v4 adds full-fidelity holding detail;
    # v5 (NIT-1) drops the never-populated instrument.instrument_type column.
    pos_cols = {r["name"] for r in conn.execute("PRAGMA table_info(position)").fetchall()}
    assert {"cost_value_base", "raw_json", "day_change_ccy", "pnl_ccy"} <= pos_cols
    inst_cols = {r["name"] for r in conn.execute("PRAGMA table_info(instrument)").fetchall()}
    assert "instrument_type" not in inst_cols
    assert "asset_class" in inst_cols
    conn.close()


def test_migrate_is_idempotent(tmp_path) -> None:
    path = tmp_path / "t.db"
    assert migrate(path) == 12
    assert migrate(path) == 12


def test_v1_to_v2_backfills_data(tmp_path) -> None:
    """Build a v1 DB (two same-day runs), migrate, and verify the state/history
    split: position keeps the LATEST run, position_snapshot one row per day."""
    path = tmp_path / "t.db"
    raw = sqlite3.connect(path)
    raw.executescript(V1_FILE.read_text(encoding="utf-8"))

    _insert_run(raw, "2026-08-06T10:00:00+00:00")
    _insert_run(raw, "2026-08-06T10:30:00+00:00")
    _insert_v1(raw, "2026-08-06T10:00:00+00:00", 1600.0, 16000.0)
    _insert_v1(raw, "2026-08-06T10:30:00+00:00", 1700.0, 17000.0)
    raw.commit()
    raw.close()

    assert migrate(path) == 12

    conn = connect(path)
    assert conn.execute("SELECT COUNT(*) FROM position").fetchone()[0] == 1
    assert conn.execute("SELECT price FROM position").fetchone()[0] == 1700.0
    assert conn.execute("SELECT COUNT(*) FROM position_snapshot").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM price_history").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM portfolio_value").fetchone()[0] == 1
    assert conn.execute("SELECT snapshot_date FROM runs").fetchone()[0] == "2026-08-06"
    assert "snapshots" not in _tables(conn)
    conn.close()


def _insert_v1(conn, run_at: str, price: float, value: float) -> None:
    conn.execute(
        """
        INSERT INTO snapshots (run_at, snapshot_date, platform, geography, ticker, name,
                               quantity, avg_price, current_price, cost_basis, current_value,
                               currency, fx_rate_to_base, current_value_base, is_eod)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (run_at, "2026-08-06", "zerodha", "IN", "INFY", "Infosys",
         10, 1500.0, price, 15000.0, value, "INR", 1.0, value, 0),
    )
