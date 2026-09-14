"""Calendar-gate wiring tests (M4): snapshot legs, --all, trades, nav, fx.

The gate POLICY lives in portfolio.calendars (pure; tested in test_calendars.py).
These tests prove the PIPELINE honors it: a skipped leg writes an audited
`skipped` runs row and returns a clean summary instead of raising
SessionNotReady, a holiday never touches a broker or the AMFI feed, and
--force bypasses the gate.

Holiday data comes from the REAL committed data/holidays files: 2026-01-26
Republic Day (NSE) and 2026-07-03 observed Independence Day (NYSE). The `at`
clock is always injected - the gate must never read the machine clock.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
import typer

import portfolio.cli as cli_mod
import portfolio.fx as fx_mod
import portfolio.mf_nav as mf_nav_mod
import portfolio.snapshot as snap
import portfolio.trades as trades_mod
from portfolio.calendars import reset_calendar_cache
from portfolio.db.migrate import migrate

IST = ZoneInfo("Asia/Kolkata")

# 2026-01-26 10:00 IST: IN holiday (Republic Day, Mon); same instant is
# 2026-01-25 23:30 EST -> Sunday evening in NY ("weekend").
REPUBLIC_DAY_IST = datetime(2026, 1, 26, 10, 0, tzinfo=IST)
# 2026-07-03 15:45 IST == 06:15 EDT: NSE trading day (EOD passes any time),
# NYSE closed (observed Independence Day - Jul 4 2026 is a Saturday).
JUL3_1545_IST = datetime(2026, 7, 3, 15, 45, tzinfo=IST)
# 2026-08-06 10:00 IST: Thursday inside NSE hours - a plain trading day.
AT_OPEN_IST = datetime(2026, 8, 6, 10, 0, tzinfo=IST)

FIXTURE = Path(__file__).parent / "fixtures" / "zerodha_holdings.json"


@pytest.fixture(autouse=True)
def _clean_calendar_cache():
    reset_calendar_cache()
    yield
    reset_calendar_cache()


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "t.db"
    migrate(path)
    return path


def _zerodha_rpc() -> dict:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return {"tool": "get_holdings", "texts": [], "parse": payload, "login_required": False}


def _kite_trades() -> dict:
    """The get_trades payload used by test_trades.py (mocked daemon RPC)."""
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


def _moomoo_collect(record: list | None = None):
    """Mocked moomoo collector; `record` gets appended to when CALLED."""
    from portfolio.normalize.moomoo import normalize_holdings

    payload = {
        "data": {
            "position_list": [
                {"code": "US.AAPL", "stock_name": "Apple Inc.", "qty": 10,
                 "cost_price": 150.0, "nominal_price": 155.0, "market_val": 1550.0},
            ]
        }
    }
    holdings = normalize_holdings(payload)

    async def collect():
        if record is not None:
            record.append(True)
        return holdings, "ACC-1"

    return collect


# ---- snapshot legs: gate before the daemon/session logic ---------------------


def test_zerodha_holiday_skips_without_touching_daemon(db, monkeypatch) -> None:
    """(a) IN holiday: skipped summary + audited row; the daemon path is never
    reached - the gate fires BEFORE ensure_zerodha_daemon."""
    daemon_calls: list = []
    monkeypatch.setattr(snap, "ensure_zerodha_daemon", lambda **kw: daemon_calls.append(True))
    monkeypatch.setattr(snap, "_fetch", lambda port, tool, args: _zerodha_rpc())

    result = snap.run_snapshot("zerodha", at=REPUBLIC_DAY_IST, db_path=db)

    assert "skipped" in result and "holiday" in result
    assert daemon_calls == []  # the gate must never spawn/probe a broker

    from portfolio.db import connect

    conn = connect(db)
    run = conn.execute("SELECT status, error, is_eod FROM runs").fetchone()
    assert run is not None and run["status"] == "skipped"
    assert "holiday" in (run["error"] or "")
    assert run["is_eod"] == 0
    assert conn.execute("SELECT COUNT(*) FROM position").fetchone()[0] == 0
    conn.close()


def test_all_us_holiday_partial_skip(db, monkeypatch) -> None:
    """(b) 2026-07-03 15:45 IST EOD: NSE trading day (runs), NYSE holiday
    (skipped) - the exit path returns normally, no raise."""
    moomoo_calls: list = []
    monkeypatch.setattr(snap, "_fetch", lambda port, tool, args: _zerodha_rpc())
    monkeypatch.setattr(snap, "_collect_moomoo", _moomoo_collect(record=moomoo_calls))

    result = snap.run_snapshot("all", is_eod=True, at=JUL3_1545_IST, db_path=db)

    assert "zerodha: ok" in result
    assert "moomoo: skipped" in result and "holiday" in result
    assert moomoo_calls == []  # moomoo skipped before any OpenD call

    from portfolio.db import connect

    conn = connect(db)
    runs = {
        r["platform"]: r["status"]
        for r in conn.execute("SELECT platform, status FROM runs").fetchall()
    }
    assert runs == {"zerodha": "ok", "moomoo": "skipped"}
    conn.close()


def test_force_bypasses_gate(db, monkeypatch) -> None:
    """(c) --force: the gate is skipped entirely - the daemon path runs even
    on a holiday and holdings persist normally."""
    daemon_calls: list = []
    monkeypatch.setattr(snap, "ensure_zerodha_daemon", lambda **kw: daemon_calls.append(True))
    monkeypatch.setattr(snap, "_fetch", lambda port, tool, args: _zerodha_rpc())

    result = snap.run_snapshot("zerodha", at=REPUBLIC_DAY_IST, force=True, db_path=db)

    assert "3 holdings" in result
    assert daemon_calls == [True]

    from portfolio.db import connect

    conn = connect(db)
    run = conn.execute("SELECT status, rows FROM runs").fetchone()
    assert run is not None and run["status"] == "ok" and run["rows"] == 3
    conn.close()


def test_all_every_leg_skipped_returns_clean_summary(db, monkeypatch) -> None:
    """(d) All-closed --all: IN holiday + NY weekend at the same instant. The
    run returns a clean per-leg skip summary - SessionNotReady must NOT be
    raised (a holiday is not a failure; exit code stays 0)."""
    monkeypatch.setattr(snap, "_fetch", lambda port, tool, args: _zerodha_rpc())
    monkeypatch.setattr(snap, "_collect_moomoo", _moomoo_collect())

    result = snap.run_snapshot("all", at=REPUBLIC_DAY_IST, db_path=db)

    assert "zerodha: skipped" in result and "Republic Day" in result
    assert "moomoo: skipped" in result and "weekend" in result
    assert "nothing captured" in result

    from portfolio.db import connect

    conn = connect(db)
    runs = {
        r["platform"]: (r["status"], r["error"] or "")
        for r in conn.execute("SELECT platform, status, error FROM runs").fetchall()
    }
    assert runs["zerodha"][0] == "skipped" and "holiday" in runs["zerodha"][1]
    assert runs["moomoo"][0] == "skipped" and "weekend" in runs["moomoo"][1]
    conn.close()


# ---- CLI gates: trades / nav / fx -------------------------------------------


def test_trades_all_closed_writes_skipped_row(db, monkeypatch, capsys) -> None:
    """(e) trades --platform all on a day when BOTH markets are closed: one
    audited platform='trades' skipped row, capture never called, exit 0."""
    monkeypatch.setenv("PORTFOLIO_DB_PATH", str(db))
    monkeypatch.setattr(cli_mod, "_now_utc", lambda: REPUBLIC_DAY_IST.astimezone(UTC))
    captured: list = []
    monkeypatch.setattr(
        trades_mod, "capture_trades",
        lambda platform, **kw: captured.append(platform) or "captured",
    )

    cli_mod.trades(platform="all", force=False)  # must not raise

    assert captured == []  # every market closed -> capture never reached
    assert "skipped" in capsys.readouterr().out

    from portfolio.db import connect

    conn = connect(db)
    run = conn.execute("SELECT platform, status, error FROM runs").fetchone()
    assert run["platform"] == "trades"
    assert run["status"] == "skipped"
    assert "holiday" in (run["error"] or "") and "weekend" in (run["error"] or "")
    conn.close()


def test_trades_running_leg_failure_writes_error_row(db, monkeypatch, capsys) -> None:
    """(MAJOR-1) A leg that RAN and failed: one platform='trades' error row
    AND the CLI exits non-zero - a capture failure is visible in `runs`,
    never a silent exit 0.

    The raised exception is trades' OWN SessionNotReady class (distinct from
    snapshot's) - the CLI's generic belt must still turn it into an audited
    error row + exit 1, never a raw traceback."""
    monkeypatch.setenv("PORTFOLIO_DB_PATH", str(db))
    monkeypatch.setattr(cli_mod, "_now_utc", lambda: AT_OPEN_IST.astimezone(UTC))

    def _boom(platform, **kw):
        raise trades_mod.SessionNotReady("zerodha daemon down - trades not captured")

    monkeypatch.setattr(trades_mod, "capture_trades", _boom)

    with pytest.raises(typer.Exit) as exc_info:
        cli_mod.trades(platform="zerodha", force=False)
    assert exc_info.value.exit_code == 1
    assert "FAILED" in capsys.readouterr().err

    from portfolio.db import connect

    conn = connect(db)
    run = conn.execute("SELECT platform, status, error FROM runs").fetchone()
    assert run["platform"] == "trades"
    assert run["status"] == "error"
    assert "daemon down" in (run["error"] or "")
    conn.close()


def test_trades_all_us_holiday_skips_moomoo_leg(db, monkeypatch, capsys) -> None:
    """(MAJOR-2) --all on 2026-07-03 (IN open, US holiday): zerodha captures,
    moomoo's broker is NEVER touched (per-leg gate inside the capture path),
    and the run exits 0 with the run row flipped to ok + a moomoo skip row."""
    monkeypatch.setenv("PORTFOLIO_DB_PATH", str(db))
    monkeypatch.setattr(cli_mod, "_now_utc", lambda: JUL3_1545_IST.astimezone(UTC))
    moomoo_calls: list = []
    # Sentinel: if the gate fails, the dispatcher would call this (and then
    # asyncio.run(str) would TypeError) - either way the assert below fires.
    monkeypatch.setattr(
        trades_mod, "_capture_moomoo",
        lambda db_path: moomoo_calls.append(True) or "captured",
    )
    monkeypatch.setattr(trades_mod, "ensure_zerodha_daemon", lambda **kw: None)
    monkeypatch.setattr(trades_mod, "_fetch", lambda port, tool, args: _kite_trades())

    cli_mod.trades(platform="all", force=False)  # must not raise

    assert moomoo_calls == []  # the US-holiday leg never touched its broker
    out = capsys.readouterr().out
    assert "zerodha: 2 new trades (2 seen)" in out
    assert "moomoo: skipped" in out and "holiday" in out

    from portfolio.db import connect

    conn = connect(db)
    runs = [
        dict(r)
        for r in conn.execute(
            "SELECT status, rows, error FROM runs WHERE platform='trades' ORDER BY id"
        ).fetchall()
    ]
    assert {r["status"] for r in runs} == {"ok", "skipped"}  # run row + moomoo skip
    ok_row = next(r for r in runs if r["status"] == "ok")
    assert ok_row["rows"] == 2  # parsed from "2 new trades (2 seen)"
    skipped = next(r for r in runs if r["status"] == "skipped")
    assert "holiday" in (skipped["error"] or "")
    conn.close()


def test_nav_refresh_in_holiday_skips_amfi(db, monkeypatch, capsys) -> None:
    """(f) nav refresh on an IN holiday: platform='amfi' skipped row AND the
    AMFI fetch function is never called."""
    monkeypatch.setenv("PORTFOLIO_DB_PATH", str(db))
    monkeypatch.setattr(cli_mod, "_now_utc", lambda: REPUBLIC_DAY_IST.astimezone(UTC))
    fetch_calls: list = []
    monkeypatch.setattr(
        mf_nav_mod, "get_nav_table",
        lambda **kw: fetch_calls.append(True) or {},
    )

    cli_mod.nav_refresh(force=False)  # must not raise

    assert fetch_calls == []  # AMFI feed never touched on a holiday
    assert "skipped" in capsys.readouterr().out

    from portfolio.db import connect

    conn = connect(db)
    run = conn.execute("SELECT platform, status, error FROM runs").fetchone()
    assert run["platform"] == "amfi"
    assert run["status"] == "skipped"
    assert "holiday" in (run["error"] or "")
    conn.close()


def test_fx_refresh_writes_two_rates(db, monkeypatch, capsys) -> None:
    """(g) fx refresh persists 2 fx_rate rows dated with the injected IST
    date; the summary prints quote+base pairs; the run is audited with one
    platform='fx' ok row (rows=2)."""
    monkeypatch.setenv("PORTFOLIO_DB_PATH", str(db))
    monkeypatch.setattr(cli_mod, "_now_utc", lambda: REPUBLIC_DAY_IST.astimezone(UTC))
    monkeypatch.setattr(
        fx_mod, "get_fx_rates", lambda base, quotes: {"USD": 88.12, "SGD": 67.90}
    )

    cli_mod.fx_refresh()

    out = capsys.readouterr().out
    assert "fx refresh: USDINR=88.12 SGDINR=67.90" in out

    from portfolio.db import connect

    conn = connect(db)
    rows = conn.execute(
        "SELECT rate_date, base, quote, source, rate FROM fx_rate ORDER BY quote"
    ).fetchall()
    assert len(rows) == 2
    assert all(r["rate_date"] == "2026-01-26" for r in rows)  # the injected IST date
    assert all(r["base"] == "INR" for r in rows)
    assert all(r["source"] == "open.er-api.com" for r in rows)
    by_quote = {r["quote"]: r["rate"] for r in rows}
    assert by_quote["USD"] == pytest.approx(88.12)
    assert by_quote["SGD"] == pytest.approx(67.90)
    # MAJOR-3: the keyless leg is visible to the runs audit.
    run = conn.execute(
        "SELECT platform, status, rows, is_eod FROM runs WHERE platform='fx'"
    ).fetchone()
    assert run is not None and run["status"] == "ok" and run["rows"] == 2
    conn.close()


def test_fx_refresh_fetch_failure_exits_clean(db, monkeypatch, capsys) -> None:
    """FXError -> a clean error message + exit 1 AND an audited platform='fx'
    error row (MAJOR-3) - never a traceback, never silent."""
    from portfolio.fx import FXError

    monkeypatch.setenv("PORTFOLIO_DB_PATH", str(db))
    monkeypatch.setattr(cli_mod, "_now_utc", lambda: REPUBLIC_DAY_IST.astimezone(UTC))

    def _boom(base: str, quotes: list[str]) -> dict[str, float]:
        raise FXError("FX fetch failed for INR")

    monkeypatch.setattr(fx_mod, "get_fx_rates", _boom)

    with pytest.raises(typer.Exit) as exc_info:
        cli_mod.fx_refresh()
    assert exc_info.value.exit_code == 1
    assert "FAILED" in capsys.readouterr().err

    from portfolio.db import connect

    conn = connect(db)
    run = conn.execute(
        "SELECT platform, status, error FROM runs WHERE platform='fx'"
    ).fetchone()
    assert run is not None and run["status"] == "error"
    assert "FX fetch failed" in (run["error"] or "")
    conn.close()


# ---- serve --gate (scheduled daemon start) ------------------------------------


def test_serve_gate_skips_on_in_holiday(monkeypatch, capsys) -> None:
    """The scheduled 09:35 daemon start must NOT fire on a holiday: it would
    prompt the daily manual 2FA login for a session nothing will use. --gate
    prints `skipped (holiday: ...)` and exits 0; serve_mod.run is never
    called."""
    monkeypatch.setattr(cli_mod, "_now_utc", lambda: REPUBLIC_DAY_IST.astimezone(UTC))
    runs: list = []

    import portfolio.serve as serve_mod

    monkeypatch.setattr(serve_mod, "run", lambda port=8788: runs.append(port))

    cli_mod.serve(platform="zerodha", gate=True)  # must not raise

    assert runs == []  # the daemon never started
    out = capsys.readouterr().out
    assert "skipped" in out and "Republic Day" in out


def test_serve_gate_runs_on_in_trading_day(monkeypatch, capsys) -> None:
    """July 3 is only a US holiday - the IN daemon start passes the gate and
    serve_mod.run IS called once (the 09:35 task must fire on trading days)."""
    monkeypatch.setattr(cli_mod, "_now_utc", lambda: JUL3_1545_IST.astimezone(UTC))
    runs: list = []

    import portfolio.serve as serve_mod

    monkeypatch.setattr(serve_mod, "run", lambda port=8788: runs.append(port))

    cli_mod.serve(platform="zerodha", gate=True)

    assert runs == [8788]
    assert "starting zerodha session daemon" in capsys.readouterr().out
