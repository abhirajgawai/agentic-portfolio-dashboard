"""Daily trade capture: zerodha + moomoo collectors, dedupe on external_id."""

from __future__ import annotations

import pytest

import portfolio.trades as trades
from portfolio.db.migrate import migrate


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "t.db"
    migrate(path)
    return path


def _kite_trades() -> dict:
    return {
        "parse": [
            {"trade_id": "T-1001", "tradingsymbol": "RELIANCE", "transaction_type": "BUY",
             "quantity": 10, "average_price": 2500.0, "price": 2500.0,
             "trade_timestamp": "2026-08-07T10:30:00+05:30"},
            {"trade_id": "T-1002", "tradingsymbol": "TCS", "transaction_type": "SELL",
             "quantity": 2, "average_price": 4100.0, "price": 4100.0,
             "trade_timestamp": "2026-08-07T11:15:00+05:30"},
        ],
        "login_required": False,
    }


def test_capture_zerodha_writes_signed_trades(db, monkeypatch):
    monkeypatch.setattr(trades, "ensure_zerodha_daemon", lambda **kw: None)
    monkeypatch.setattr(trades, "_fetch", lambda port, tool, args: _kite_trades())

    result = trades.capture_trades("zerodha", db_path=db)
    assert "2 new trades (2 seen)" in result

    from portfolio.db import connect

    conn = connect(db)
    rows = conn.execute(
        "SELECT i.ticker, t.quantity, t.amount_ccy, t.external_id, t.trade_date FROM trade t"
        " JOIN instrument i ON i.id=t.instrument_id ORDER BY i.ticker"
    ).fetchall()
    assert len(rows) == 2
    rel = next(r for r in rows if r["ticker"] == "RELIANCE")
    tcs = next(r for r in rows if r["ticker"] == "TCS")
    assert rel["quantity"] == 10.0  # BUY -> +
    assert rel["amount_ccy"] == 25000.0
    assert tcs["quantity"] == -2.0  # SELL -> -
    assert tcs["amount_ccy"] == -8200.0
    assert rel["trade_date"] == "2026-08-07"
    conn.close()


def test_capture_zerodha_dedupes_on_rerun(db, monkeypatch):
    monkeypatch.setattr(trades, "ensure_zerodha_daemon", lambda **kw: None)
    monkeypatch.setattr(trades, "_fetch", lambda port, tool, args: _kite_trades())

    trades.capture_trades("zerodha", db_path=db)
    result = trades.capture_trades("zerodha", db_path=db)
    assert "0 new trades (2 seen)" in result

    from portfolio.db import connect

    conn = connect(db)
    assert conn.execute("SELECT COUNT(*) FROM trade").fetchone()[0] == 2
    conn.close()


def test_capture_unknown_platform_raises():
    with pytest.raises(ValueError, match="unknown platform"):
        trades.capture_trades("groww")  # paid-API leg removed (CAS replaces it)
