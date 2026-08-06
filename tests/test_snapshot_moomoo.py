"""Moomoo leg + consolidated `--all` snapshot tests (collection mocked).

FX is faked (1 USD = 90 INR) so no network; the same fake is used for
get_fx_rate (position rows) and get_fx_rates (allocation), keeping the
one-rate-per-run contract intact.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import portfolio.snapshot as snap
from portfolio.db.migrate import migrate
from portfolio.normalize.moomoo import normalize_holdings as normalize_moomoo

FIXTURE = Path(__file__).parent / "fixtures" / "zerodha_holdings.json"

USD_INR = 90.0


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

    monkeypatch.setattr(snap, "get_fx_rate", rate)
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
    result = snap.run_snapshot("moomoo", db_path=db)
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
    result = snap.run_snapshot("all", db_path=db)

    from portfolio.db import connect

    conn = connect(db)
    # 3 zerodha + 2 moomoo positions, no history on a non-EOD poll
    assert conn.execute("SELECT COUNT(*) FROM position").fetchone()[0] == 5
    assert conn.execute("SELECT COUNT(*) FROM position_snapshot").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM portfolio_value").fetchone()[0] == 0
    # runs: one per leg
    assert conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 2
    assert "total=" in result
    conn.close()


def test_all_eod_writes_one_consolidated_value_set(db, monkeypatch):
    """Regression: the 'all' scope must be written ONCE with BOTH platforms."""
    monkeypatch.setattr(snap, "_fetch", lambda port, tool, args: _zerodha_rpc())
    monkeypatch.setattr(snap, "_collect_moomoo", _moomoo_collect())
    snap.run_snapshot("all", is_eod=True, db_path=db)

    from portfolio.db import connect

    conn = connect(db)
    # scopes: all + geography(IN,US) + platform(zerodha,moomoo) = 5 rows
    rows = conn.execute("SELECT scope_type, scope_key, value_base FROM portfolio_value ORDER BY scope_type, scope_key").fetchall()
    assert len(rows) == 5
    by_scope = {(r["scope_type"], r["scope_key"]): r["value_base"] for r in rows}
    zerodha_total = 16100.0 + 3400.0 + 19000.0
    moomoo_total = (1550.0 + 600.0) * USD_INR
    assert by_scope[("all", "")] == pytest.approx(zerodha_total + moomoo_total)
    assert by_scope[("platform", "zerodha")] == pytest.approx(zerodha_total)
    assert by_scope[("platform", "moomoo")] == pytest.approx(moomoo_total)
    assert by_scope[("geography", "IN")] == pytest.approx(zerodha_total)
    assert by_scope[("geography", "US")] == pytest.approx(moomoo_total)
    conn.close()


def test_all_allocation_sums_to_100(db, monkeypatch):
    monkeypatch.setattr(snap, "_fetch", lambda port, tool, args: _zerodha_rpc())
    monkeypatch.setattr(snap, "_collect_moomoo", _moomoo_collect())
    result = snap.run_snapshot("all", db_path=db)

    # result layout: each dimension is its own "|"-separated part now.
    parts = result.split(" | ")
    for dim in ("geography", "platform", "sector", "asset_class"):
        section = next(p for p in parts if p.startswith(f"{dim}: "))
        shares_text = section.split(": ", 1)[1]
        shares = [float(x.split("=")[1].rstrip("%")) for x in shares_text.split(", ")]
        assert sum(shares) == pytest.approx(100.0, abs=0.6)
