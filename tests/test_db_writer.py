"""Write-path (db/writer.py): UNIQUE-keyed upserts never create junk rows."""

from __future__ import annotations

import sqlite3

import pytest

from portfolio.db import connect, writer
from portfolio.db.migrate import migrate


@pytest.fixture()
def conn(tmp_path):
    path = tmp_path / "t.db"
    migrate(path)
    c = connect(path)
    yield c
    c.close()


def test_ensure_account_is_idempotent(conn) -> None:
    a1 = writer.ensure_account(conn, "zerodha")
    a2 = writer.ensure_account(conn, "zerodha")
    a3 = writer.ensure_account(conn, "groww")
    assert a1 == a2
    assert a1 != a3


def test_ensure_instrument_creates_then_enriches(conn) -> None:
    i1 = writer.ensure_instrument(conn, "zerodha", "INFY", currency="INR", geography="IN")
    i2 = writer.ensure_instrument(
        conn, "zerodha", "INFY", currency="INR", name="Infosys", sector="IT Services"
    )
    assert i1 == i2
    row = conn.execute("SELECT name, sector FROM instrument WHERE id=?", (i1,)).fetchone()
    assert row["name"] == "Infosys"
    assert row["sector"] == "IT Services"


def test_write_run_returns_id_and_blocks_duplicate(conn) -> None:
    run_id = writer.write_run(conn, "zerodha", "2026-08-06", "t1")
    assert isinstance(run_id, int)
    with pytest.raises(sqlite3.IntegrityError):
        writer.write_run(conn, "zerodha", "2026-08-06", "t1")


def test_upsert_position_in_place(conn) -> None:
    acc = writer.ensure_account(conn, "zerodha")
    inst = writer.ensure_instrument(conn, "zerodha", "INFY", currency="INR")
    writer.upsert_position(
        conn, acc, inst, quantity=10, avg_cost=1500.0, price=1600.0,
        cost_value_ccy=15000.0, market_value_ccy=16000.0, market_value_base=16000.0, updated_at="t1",
    )
    writer.upsert_position(
        conn, acc, inst, quantity=10, avg_cost=1500.0, price=1700.0,
        cost_value_ccy=15000.0, market_value_ccy=17000.0, market_value_base=17000.0, updated_at="t2",
    )
    assert conn.execute("SELECT COUNT(*) FROM position").fetchone()[0] == 1
    assert conn.execute("SELECT price FROM position").fetchone()[0] == 1700.0


def test_upsert_position_snapshot_dedupes_per_day(conn) -> None:
    acc = writer.ensure_account(conn, "zerodha")
    inst = writer.ensure_instrument(conn, "zerodha", "INFY", currency="INR")
    run = writer.write_run(conn, "zerodha", "2026-08-06", "t1", is_eod=True)
    for price in (1600.0, 1700.0):
        writer.upsert_position_snapshot(
            conn, run, acc, inst, None, "2026-08-06",
            quantity=10, avg_cost=1500.0, price=price,
            cost_value_ccy=15000.0, market_value_ccy=price * 10, market_value_base=price * 10,
        )
    assert conn.execute("SELECT COUNT(*) FROM position_snapshot").fetchone()[0] == 1
    assert conn.execute("SELECT price FROM position_snapshot").fetchone()[0] == 1700.0


def test_upsert_price_dedupes_per_day(conn) -> None:
    inst = writer.ensure_instrument(conn, "zerodha", "INFY", currency="INR")
    writer.upsert_price(conn, inst, "2026-08-06", 1600.0, "INR")
    writer.upsert_price(conn, inst, "2026-08-06", 1700.0, "INR")
    assert conn.execute("SELECT COUNT(*) FROM price_history").fetchone()[0] == 1
    assert conn.execute("SELECT close FROM price_history").fetchone()[0] == 1700.0


def test_ensure_fx_rate_identity_returns_none(conn) -> None:
    assert writer.ensure_fx_rate(conn, "2026-08-06", "INR", "INR", "x", 1.0, "t") is None


def test_ensure_fx_rate_persists_once(conn) -> None:
    id1 = writer.ensure_fx_rate(conn, "2026-08-06", "INR", "USD", "open.er-api.com", 83.5, "t1")
    id2 = writer.ensure_fx_rate(conn, "2026-08-06", "INR", "USD", "open.er-api.com", 83.5, "t2")
    assert id1 == id2
    assert conn.execute("SELECT COUNT(*) FROM fx_rate").fetchone()[0] == 1
