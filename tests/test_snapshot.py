"""Snapshot orchestration e2e (daemon RPC mocked): state/history split, runs log, expiry."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

import portfolio.snapshot as snap
from portfolio.db.migrate import migrate

FIXTURE = Path(__file__).parent / "fixtures" / "zerodha_holdings.json"

# M4: the calendar gate now guards run_snapshot, so tests must inject a
# deterministic wall clock inside NSE hours on a trading day (2026-08-06 is a
# Thursday, no holiday in the committed data/holidays lists) - never now().
IST = ZoneInfo("Asia/Kolkata")
AT_OPEN = datetime(2026, 8, 6, 10, 0, tzinfo=IST)  # inside NSE 09:15-15:30 IST


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "t.db"
    migrate(path)
    return path


def _rpc_payload_ok() -> dict:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return {"tool": "get_holdings", "texts": [], "parse": payload, "login_required": False}


def test_snapshot_writes_live_position_and_run_log(db, monkeypatch) -> None:
    monkeypatch.setattr(snap, "_fetch", lambda port, tool, args: _rpc_payload_ok())
    result = snap.run_snapshot("zerodha", db_path=db, at=AT_OPEN)
    assert "3 holdings" in result

    from portfolio.db import connect

    conn = connect(db)
    # live state only - no history on a non-EOD poll
    assert conn.execute("SELECT COUNT(*) FROM position").fetchone()[0] == 3
    assert conn.execute("SELECT COUNT(*) FROM position_snapshot").fetchone()[0] == 0
    runs = conn.execute("SELECT status, rows, is_eod FROM runs").fetchall()
    assert len(runs) == 1
    assert runs[0]["status"] == "ok"
    assert runs[0]["rows"] == 3
    assert runs[0]["is_eod"] == 0
    infy = conn.execute(
        "SELECT p.market_value_base, p.market_value_ccy, i.currency, i.geography"
        " FROM position p JOIN instrument i ON i.id = p.instrument_id WHERE i.ticker='INFY'"
    ).fetchone()
    assert infy["currency"] == "INR"
    assert infy["geography"] == "IN"
    assert infy["market_value_ccy"] == 16100.0
    assert infy["market_value_base"] == 16100.0
    conn.close()


def test_repeated_polls_do_not_grow_position(db, monkeypatch) -> None:
    """The 'no junk' rule: 100 polls still leave exactly one row per holding."""
    monkeypatch.setattr(snap, "_fetch", lambda port, tool, args: _rpc_payload_ok())
    for _ in range(5):
        snap.run_snapshot("zerodha", db_path=db, at=AT_OPEN)

    from portfolio.db import connect

    conn = connect(db)
    assert conn.execute("SELECT COUNT(*) FROM position").fetchone()[0] == 3
    assert conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 5
    conn.close()


def test_eod_run_writes_daily_history(db, monkeypatch) -> None:
    monkeypatch.setattr(snap, "_fetch", lambda port, tool, args: _rpc_payload_ok())
    snap.run_snapshot("zerodha", is_eod=True, db_path=db, at=AT_OPEN)

    from portfolio.db import connect

    conn = connect(db)
    assert conn.execute("SELECT COUNT(*) FROM position").fetchone()[0] == 3
    assert conn.execute("SELECT COUNT(*) FROM position_snapshot").fetchone()[0] == 3
    assert conn.execute("SELECT COUNT(*) FROM price_history").fetchone()[0] == 3
    # F1: the portfolio_value write path is removed - an EOD leg writes the
    # daily ledger only; the value series is derived from position_snapshot at
    # export time (portfolio.series), never stored incrementally.
    assert conn.execute("SELECT COUNT(*) FROM portfolio_value").fetchone()[0] == 0
    conn.close()


def test_eod_rerun_same_day_updates_not_duplicates(db, monkeypatch) -> None:
    monkeypatch.setattr(snap, "_fetch", lambda port, tool, args: _rpc_payload_ok())
    snap.run_snapshot("zerodha", is_eod=True, db_path=db, at=AT_OPEN)
    snap.run_snapshot("zerodha", is_eod=True, db_path=db, at=AT_OPEN)

    from portfolio.db import connect

    conn = connect(db)
    assert conn.execute("SELECT COUNT(*) FROM position_snapshot").fetchone()[0] == 3
    # F1: no portfolio_value rows at all (write path removed) - a same-day EOD
    # re-run must not create any either.
    assert conn.execute("SELECT COUNT(*) FROM portfolio_value").fetchone()[0] == 0
    conn.close()


def test_expired_session_warns_and_logs_error(db, monkeypatch) -> None:
    monkeypatch.setattr(
        snap, "_fetch",
        lambda port, tool, args: {"texts": ["Please log in first using the login tool"],
                                  "login_required": True, "parse": None},
    )
    with pytest.raises(snap.SessionNotReady):
        snap.run_snapshot("zerodha", db_path=db, at=AT_OPEN)

    from portfolio.db import connect

    conn = connect(db)
    run = conn.execute("SELECT status, error FROM runs").fetchone()
    assert run["status"] == "error"
    assert "session expired" in (run["error"] or "")
    assert conn.execute("SELECT COUNT(*) FROM position").fetchone()[0] == 0
    conn.close()


def test_daemon_down_raises_clear_error(db, monkeypatch) -> None:
    """F3: RPC unreachable must leave an audited `runs` error row - a scheduled
    run with the daemon down must be VISIBLE in the runs audit (M4 bar), not
    vanish because the failure raised before any write_run."""
    def _down(port, tool, args):
        raise snap.SessionNotReady("cannot reach zerodha daemon on :8787 - start it with `portfolio serve`")

    monkeypatch.setattr(snap, "_fetch", _down)
    with pytest.raises(snap.SessionNotReady, match="serve"):
        snap.run_snapshot("zerodha", db_path=db, at=AT_OPEN)

    from portfolio.db import connect

    conn = connect(db)
    run = conn.execute("SELECT status, error FROM runs").fetchone()
    assert run is not None and run["status"] == "error"
    assert "cannot reach zerodha daemon" in (run["error"] or "")
    conn.close()


def test_daemon_spawn_timeout_writes_runs_error(db, monkeypatch) -> None:
    """F3: the daemon failing to come up (spawn + manual-login timeout) is the
    other pre-write_run failure - it must also leave an audited runs error row."""
    monkeypatch.delenv("PORTFOLIO_NO_DAEMON", raising=False)

    def _never_up():
        raise snap.SessionNotReady(
            "zerodha daemon did not come up in time - check data/logs/zerodha_serve.log "
            "(a manual browser 2FA login is required)."
        )

    monkeypatch.setattr(snap, "ensure_zerodha_daemon", _never_up)
    with pytest.raises(snap.SessionNotReady, match="daemon did not come up"):
        snap.run_snapshot("zerodha", db_path=db, at=AT_OPEN)

    from portfolio.db import connect

    conn = connect(db)
    run = conn.execute("SELECT status, error FROM runs").fetchone()
    assert run is not None and run["status"] == "error"
    assert "daemon did not come up" in (run["error"] or "")
    assert conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 1  # no double-write
    conn.close()


def test_malformed_holdings_row_writes_error_run_and_raises(db, monkeypatch) -> None:
    """M-2 regression: broker payload shape drift (a bad float) must leave an
    audited `runs` error row and surface as SessionNotReady - never a raw
    traceback that would kill `--all`'s remaining legs."""
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    payload[0]["quantity"] = "not-a-number"
    monkeypatch.setattr(
        snap, "_fetch",
        lambda port, tool, args: {"tool": "get_holdings", "texts": [], "parse": payload, "login_required": False},
    )
    with pytest.raises(snap.SessionNotReady, match="zerodha snapshot failed"):
        snap.run_snapshot("zerodha", db_path=db, at=AT_OPEN)

    from portfolio.db import connect

    conn = connect(db)
    run = conn.execute("SELECT status, error FROM runs").fetchone()
    assert run is not None and run["status"] == "error"
    assert "missing/not numeric" in (run["error"] or "")
    assert conn.execute("SELECT COUNT(*) FROM position").fetchone()[0] == 0
    conn.close()


# ---- daemon auto-launch (M2: `snapshot --all` starts serve for you) ----------


def test_ensure_daemon_returns_fast_when_up(monkeypatch) -> None:
    monkeypatch.delenv("PORTFOLIO_NO_DAEMON", raising=False)
    monkeypatch.setattr(snap, "daemon_health", lambda: {"ok": True, "auth": True})
    spawned = []
    monkeypatch.setattr(snap, "_spawn_zerodha_daemon", lambda: spawned.append(True))
    snap.ensure_zerodha_daemon()  # must not raise and not spawn
    assert spawned == []


def test_ensure_daemon_spawns_and_waits_until_healthy(monkeypatch) -> None:
    monkeypatch.delenv("PORTFOLIO_NO_DAEMON", raising=False)
    state = {"up": False}

    def health():
        return {"ok": True, "auth": True} if state["up"] else None

    monkeypatch.setattr(snap, "daemon_health", health)
    spawned = []
    monkeypatch.setattr(snap, "_spawn_zerodha_daemon", lambda: spawned.append(True))

    class _FakeTime:
        calls = 0

        @staticmethod
        def monotonic():
            _FakeTime.calls += 1
            return _FakeTime.calls  # 1 -> deadline=1+330; next check 2 < 331

        @staticmethod
        def sleep(_s):
            state["up"] = True  # daemon comes up during the wait

    monkeypatch.setattr(snap, "time", _FakeTime())
    snap.ensure_zerodha_daemon()
    assert spawned == [True]


def test_ensure_daemon_raises_when_never_healthy(monkeypatch) -> None:
    monkeypatch.delenv("PORTFOLIO_NO_DAEMON", raising=False)
    monkeypatch.setattr(snap, "daemon_health", lambda: None)
    monkeypatch.setattr(snap, "_spawn_zerodha_daemon", lambda: None)

    class _FakeTime:
        n = 0

        @staticmethod
        def monotonic():
            _FakeTime.n += 1
            return _FakeTime.n * 1000  # jumps past the deadline immediately

        @staticmethod
        def sleep(_s):
            pass

    monkeypatch.setattr(snap, "time", _FakeTime())
    with pytest.raises(snap.SessionNotReady, match="daemon did not come up"):
        snap.ensure_zerodha_daemon()


def test_no_daemon_env_skips_auto_launch(monkeypatch) -> None:
    monkeypatch.setenv("PORTFOLIO_NO_DAEMON", "1")
    spawned = []
    monkeypatch.setattr(snap, "_spawn_zerodha_daemon", lambda: spawned.append(True))
    monkeypatch.setattr(snap, "daemon_health", lambda: None)
    snap.ensure_zerodha_daemon()  # must not spawn, must not raise
    assert spawned == []
