"""Moomoo leg + consolidated `--all` snapshot tests (collection mocked).

FX is faked (1 USD = 90 INR) so no network; the same fake is used for
get_fx_rate (position rows) and get_fx_rates (allocation), keeping the
one-rate-per-run contract intact.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

import portfolio.snapshot as snap
from portfolio.db.migrate import migrate
from portfolio.normalize.moomoo import normalize_holdings as normalize_moomoo

FIXTURE = Path(__file__).parent / "fixtures" / "zerodha_holdings.json"

USD_INR = 90.0

# M4: the calendar gate now guards run_snapshot, so tests inject a
# deterministic wall clock. No single instant is inside BOTH NSE (09:15-15:30
# IST) and NYSE (09:30-16:00 ET) hours, so:
#   - single moomoo legs use a US-open instant (21:30 IST == 12:00 EDT),
#   - live `--all` runs use force=True (their point is persist/allocation, not
#     the gate - which has its own tests in test_gate.py).
# 2026-08-06 is a Thursday, no holiday in the committed data/holidays lists.
IST = ZoneInfo("Asia/Kolkata")
AT_US_OPEN = datetime(2026, 8, 6, 21, 30, tzinfo=IST)  # 12:00 EDT, NYSE open


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "t.db"
    migrate(path)
    return path


@pytest.fixture(autouse=True)
def _fake_fx(monkeypatch):
    def rate(base, quote, **kw):
        return 1.0 if base == quote else USD_INR

    def rates(base, quotes, **kw):
        return {q: USD_INR for q in quotes if q != base}

    # get_fx_rate is now consumed inside the shared write layer (db/persist);
    # snapshot keeps only get_fx_rates (the --all allocation fetch).
    import portfolio.db.persist as persist_mod

    monkeypatch.setattr(persist_mod, "get_fx_rate", rate)
    monkeypatch.setattr(snap, "get_fx_rates", rates)


def _moomoo_payload() -> dict:
    return {
        "data": {
            "position_list": [
                {"code": "US.AAPL", "stock_name": "Apple Inc.", "qty": 10,
                 "cost_price": 150.0, "nominal_price": 155.0, "market_val": 1550.0},
                {"code": "US.NVDA", "stock_name": "NVIDIA", "qty": 5,
                 "cost_price": 100.0, "nominal_price": 120.0, "market_val": 600.0},
            ]
        }
    }


def _moomoo_collect(payload=None):
    holdings = normalize_moomoo(payload or _moomoo_payload())
    async def collect():
        return holdings, "ACC-1"
    return collect


def _zerodha_rpc() -> dict:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return {"tool": "get_holdings", "texts": [], "parse": payload, "login_required": False}


def test_pick_real_account():
    payload = {"data": [
        {"acc_id": "SIM-1", "trd_env": "SIMULATE", "acc_type": "CASH"},
        {"acc_id": "ACC-9", "trd_env": "REAL", "acc_type": "MARGIN"},
    ]}
    assert snap._pick_real_account(payload) == "ACC-9"


def test_pick_real_account_prefers_trd_env_over_acc_type():
    """acc_type is the account kind (MARGIN/CASH); trd_env is the REAL/SIMULATE flag."""
    acc = {"acc_id": 283726804802132510, "trd_env": "REAL", "acc_type": "MARGIN"}
    assert snap._pick_real_account(acc) == "283726804802132510"
    assert snap._pick_real_account([{"acc_id": "SIM", "trd_env": "SIMULATE", "acc_type": "MARGIN"}]) is None


def test_moomoo_snapshot_writes_position_with_fx(db, monkeypatch):
    monkeypatch.setattr(snap, "_collect_moomoo", _moomoo_collect())
    result = snap.run_snapshot("moomoo", db_path=db, at=AT_US_OPEN)
    assert "2 holdings" in result

    from portfolio.db import connect

    conn = connect(db)
    assert conn.execute("SELECT COUNT(*) FROM position").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM position_snapshot").fetchone()[0] == 0
    aapl = conn.execute(
        "SELECT p.market_value_ccy, p.market_value_base, i.currency, i.geography, a.account_ref"
        " FROM position p JOIN instrument i ON i.id=p.instrument_id"
        " JOIN account a ON a.id=p.account_id WHERE i.ticker='AAPL'"
    ).fetchone()
    assert aapl["currency"] == "USD"
    assert aapl["geography"] == "US"
    assert aapl["market_value_ccy"] == 1550.0
    assert aapl["market_value_base"] == pytest.approx(1550.0 * USD_INR)
    assert aapl["account_ref"] == "ACC-1"
    conn.close()


def test_moomoo_unavailable_warns_and_fails(db, monkeypatch):
    """OpenD down / holdings unreadable -> Telegram warning + error, never a crash."""
    import asyncio

    import portfolio.clients.moomoo as moomoo_mod

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def call(self, tool, args=None):
            raise RuntimeError("cannot reach OpenD on 127.0.0.1:11111")

    monkeypatch.setattr(moomoo_mod, "MoomooMCPClient", FakeClient)
    sent = []
    monkeypatch.setattr(
        snap, "send_snapshot_expiry_warning",
        lambda platform, reason, settings=None, action=None: sent.append((platform, action)),
    )
    with pytest.raises(snap.SessionNotReady, match="OpenD running"):
        asyncio.run(snap._collect_moomoo())
    assert sent and sent[0][0] == "moomoo"
    assert "OpenD" in sent[0][1]


def test_all_non_eod_keeps_consolidated_position_rows(db, monkeypatch):
    monkeypatch.setattr(snap, "_fetch", lambda port, tool, args: _zerodha_rpc())
    monkeypatch.setattr(snap, "_collect_moomoo", _moomoo_collect())
    result = snap.run_snapshot("all", db_path=db, force=True)

    from portfolio.db import connect

    conn = connect(db)
    # 3 zerodha + 2 moomoo positions, no history on a non-EOD poll
    assert conn.execute("SELECT COUNT(*) FROM position").fetchone()[0] == 5
    assert conn.execute("SELECT COUNT(*) FROM position_snapshot").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM portfolio_value").fetchone()[0] == 0
    # runs: one per leg (zerodha ok, moomoo ok)
    assert conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 2
    assert "total=" in result
    conn.close()


def test_all_eod_writes_no_portfolio_value_rows(db, monkeypatch):
    """F1: the portfolio_value write path is removed - an EOD `--all` run writes
    the state + daily ledger only; the value series is derived from
    position_snapshot at export time (portfolio.series), never stored."""
    monkeypatch.setattr(snap, "_fetch", lambda port, tool, args: _zerodha_rpc())
    monkeypatch.setattr(snap, "_collect_moomoo", _moomoo_collect())
    snap.run_snapshot("all", is_eod=True, db_path=db, at=AT_US_OPEN)

    from portfolio.db import connect

    conn = connect(db)
    # daily ledger written for both legs (3 zerodha + 2 moomoo)
    assert conn.execute("SELECT COUNT(*) FROM position_snapshot").fetchone()[0] == 5
    assert conn.execute("SELECT COUNT(*) FROM price_history").fetchone()[0] == 5
    # ...but NO portfolio_value rows (legacy table, unread)
    assert conn.execute("SELECT COUNT(*) FROM portfolio_value").fetchone()[0] == 0
    # runs: one per leg (zerodha ok, moomoo ok)
    assert conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 2
    conn.close()


def test_moomoo_collect_failure_writes_runs_error(db, monkeypatch):
    """F3 symmetry: a moomoo collection failure (OpenD down / accounts call
    error) raises SessionNotReady AND leaves an audited `runs` error row."""
    async def _collect_fails():
        raise snap.SessionNotReady("cannot reach OpenD on 127.0.0.1:11111")

    monkeypatch.setattr(snap, "_collect_moomoo", _collect_fails)
    with pytest.raises(snap.SessionNotReady, match="OpenD"):
        snap.run_snapshot("moomoo", db_path=db, at=AT_US_OPEN)

    from portfolio.db import connect

    conn = connect(db)
    run = conn.execute("SELECT status, error FROM runs").fetchone()
    assert run is not None and run["status"] == "error"
    assert "OpenD" in (run["error"] or "")
    conn.close()


def test_all_allocation_sums_to_100(db, monkeypatch):
    monkeypatch.setattr(snap, "_fetch", lambda port, tool, args: _zerodha_rpc())
    monkeypatch.setattr(snap, "_collect_moomoo", _moomoo_collect())
    result = snap.run_snapshot("all", db_path=db, force=True)

    # result layout: each dimension is its own "|"-separated part now.
    parts = result.split(" | ")
    for dim in ("geography", "platform", "sector", "asset_class"):
        section = next(p for p in parts if p.startswith(f"{dim}: "))
        shares_text = section.split(": ", 1)[1]
        shares = [float(x.split("=")[1].rstrip("%")) for x in shares_text.split(", ")]
        assert sum(shares) == pytest.approx(100.0, abs=0.6)


def test_all_continues_when_one_leg_fails(db, monkeypatch):
    """M-2 regression: a malformed zerodha row must NOT kill the moomoo leg.

    The failed leg leaves an audited `runs` error row; --all completes the
    remaining legs and reports the failure in the summary line.
    """
    bad = json.loads(FIXTURE.read_text(encoding="utf-8"))
    bad[0]["last_price"] = "boom"
    monkeypatch.setattr(
        snap, "_fetch",
        lambda port, tool, args: {"tool": "get_holdings", "texts": [], "parse": bad, "login_required": False},
    )
    monkeypatch.setattr(snap, "_collect_moomoo", _moomoo_collect())

    result = snap.run_snapshot("all", db_path=db, force=True)

    from portfolio.db import connect

    conn = connect(db)
    # moomoo's 2 positions persisted despite the zerodha failure
    assert conn.execute("SELECT COUNT(*) FROM position").fetchone()[0] == 2
    runs = {
        r["platform"]: r["status"]
        for r in conn.execute("SELECT platform, status FROM runs ORDER BY platform").fetchall()
    }
    assert runs == {"zerodha": "error", "moomoo": "ok"}
    conn.close()
    assert "FAILED: zerodha" in result
    assert "moomoo: ok: 2 holdings" in result
    assert "total=" in result
