"""M6 alert engine tests: fire-once dedupe, no-fire, next-day refire, dry-run,
unconfigured-Telegram grace, and the per-item metrics.

The dedupe backbone is alert_events.UNIQUE(rule_id, event_date) with
ON CONFLICT DO NOTHING - these tests pin the "no spam on re-runs" bar exactly:
the same (rule, day) records and sends once, a different day fires again.

Determinism: `today`/`now_utc` are injected everywhere; the engine never reads
a clock. send_telegram is monkeypatched (the engine's bound name) so no test
touches the network or the real Telegram env.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

import portfolio.alerts.engine as engine_mod
import portfolio.cli as cli_mod
from portfolio.db import connect, writer
from portfolio.db.migrate import migrate

# The engine's bound send_telegram name is what dedupe_and_send calls - patch
# that, per the repo convention (snapshot tests patch snap.send_* the same way).
SEND = "portfolio.alerts.engine.send_telegram"
WRITE = "portfolio.alerts.engine.write_alerts_json"


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "t.db"
    migrate(path)  # applies 0006 -> alert_events exists
    return path


def _utc(iso: str) -> datetime:
    """Aware-UTC datetime (the engine refuses naive clocks, like calendars)."""
    dt = datetime.fromisoformat(iso)
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def _seed_position(
    conn,
    *,
    platform: str = "zerodha",
    ticker: str = "RELIANCE",
    cost_value_base: float | None = 900.0,
    market_value_base: float = 1000.0,
    day_change_ccy: float = 0.0,
    updated_at: str = "2026-08-14T12:00:00+00:00",
    currency: str = "INR",
) -> None:
    """One position (writer helpers, like test_returns.py's seeds)."""
    acc = writer.ensure_account(conn, platform, base_currency=currency)
    inst = writer.ensure_instrument(
        conn, platform, ticker, currency=currency, geography="IN", asset_class="equity"
    )
    writer.upsert_position(
        conn, acc, inst,
        quantity=10.0, avg_cost=cost_value_base / 10.0 if cost_value_base else None,
        price=market_value_base / 10.0, cost_value_ccy=cost_value_base,
        market_value_ccy=market_value_base, market_value_base=market_value_base,
        cost_value_base=cost_value_base, day_change_ccy=day_change_ccy,
        updated_at=updated_at,
    )


def _rule(**overrides) -> list[dict]:
    """One rule with sane defaults (a portfolio total below 1,000,000 INR)."""
    rule: dict = {
        "id": "test_rule",
        "name": "Test rule",
        "type": "portfolio",
        "metric": "total_value_base",
        "op": "lt",
        "threshold": 1_000_000.0,
        "severity": "warn",
    }
    rule.update(overrides)
    return [rule]


# ---- the dedupe backbone ------------------------------------------------------


def test_rule_fires_once_then_same_day_dedupes(db, monkeypatch) -> None:
    """(a) A firing rule records + sends EXACTLY once per day; a same-day
    re-evaluation (retries, export + manual run) sends nothing more."""
    conn = connect(db)
    try:
        _seed_position(conn, market_value_base=500.0)
    finally:
        conn.close()
    sent: list[str] = []
    monkeypatch.setattr(engine_mod, "send_telegram", lambda text, **kw: sent.append(text) or True)

    conn = connect(db)
    try:
        fired = engine_mod.evaluate(conn, _rule(), today="2026-08-14", now_utc=_utc("2026-08-14T12:00:00"))
        assert len(fired) == 1
        # Message: name, metric value vs threshold, timestamp. Severity rides
        # in the batched Telegram header (asserted below).
        assert "Test rule" in fired[0]["message"] and "total_value_base" in fired[0]["message"]
        assert "2026-08-14T12:00:00" in fired[0]["message"]

        new1 = engine_mod.dedupe_and_send(conn, fired, today="2026-08-14", now_utc=_utc("2026-08-14T12:00:00"))
        assert len(new1) == 1
        assert len(sent) == 1  # ONE batched Telegram message
        assert "Portfolio alerts" in sent[0] and "Test rule" in sent[0] and "[warn]" in sent[0]

        # Same day, later evaluation: the rule still fires (evaluate is pure)
        # but dedupe records/sends NOTHING new.
        fired2 = engine_mod.evaluate(conn, _rule(), today="2026-08-14", now_utc=_utc("2026-08-14T18:00:00"))
        assert len(fired2) == 1
        new2 = engine_mod.dedupe_and_send(conn, fired2, today="2026-08-14", now_utc=_utc("2026-08-14T18:00:00"))
        assert new2 == []
        assert len(sent) == 1  # no second message
        assert conn.execute("SELECT COUNT(*) FROM alert_events").fetchone()[0] == 1
    finally:
        conn.close()


def test_rule_that_does_not_fire_sends_nothing(db, monkeypatch) -> None:
    """(b) A rule that does NOT fire -> zero messages, zero alert_events rows."""
    conn = connect(db)
    try:
        _seed_position(conn, market_value_base=2_000_000.0)  # above the threshold
    finally:
        conn.close()
    sent: list[str] = []
    monkeypatch.setattr(engine_mod, "send_telegram", lambda text, **kw: sent.append(text) or True)

    conn = connect(db)
    try:
        fired = engine_mod.evaluate(conn, _rule(), today="2026-08-14", now_utc=_utc("2026-08-14T12:00:00"))
        assert fired == []
        new = engine_mod.dedupe_and_send(conn, fired, today="2026-08-14", now_utc=_utc("2026-08-14T12:00:00"))
        assert new == [] and sent == []
        assert conn.execute("SELECT COUNT(*) FROM alert_events").fetchone()[0] == 0
    finally:
        conn.close()


def test_rule_fires_again_next_day(db, monkeypatch) -> None:
    """(c) The dedupe key is (rule, event_date): a NEW day fires and sends
    again (a sustained condition is re-reported daily, not suppressed forever)."""
    conn = connect(db)
    try:
        _seed_position(conn, market_value_base=500.0)
    finally:
        conn.close()
    sent: list[str] = []
    monkeypatch.setattr(engine_mod, "send_telegram", lambda text, **kw: sent.append(text) or True)

    conn = connect(db)
    try:
        rules = _rule()
        for day in ("2026-08-14", "2026-08-15"):
            fired = engine_mod.evaluate(conn, rules, today=day, now_utc=_utc(f"{day}T12:00:00"))
            new = engine_mod.dedupe_and_send(conn, fired, today=day, now_utc=_utc(f"{day}T12:00:00"))
            assert len(new) == 1
        assert len(sent) == 2
        rows = conn.execute(
            "SELECT rule_id, event_date FROM alert_events ORDER BY event_date"
        ).fetchall()
        assert [(r["rule_id"], r["event_date"]) for r in rows] == [
            ("test_rule", "2026-08-14"),
            ("test_rule", "2026-08-15"),
        ]
    finally:
        conn.close()


def test_unconfigured_telegram_graceful(db, monkeypatch) -> None:
    """(e) No TELEGRAM_* env -> send_telegram logs + returns False (never
    crashes); the event is STILL recorded so the same-day dedupe stays honest."""
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    conn = connect(db)
    try:
        _seed_position(conn, market_value_base=500.0)
    finally:
        conn.close()

    conn = connect(db)
    try:
        fired = engine_mod.evaluate(conn, _rule(), today="2026-08-14", now_utc=_utc("2026-08-14T12:00:00"))
        new = engine_mod.dedupe_and_send(conn, fired, today="2026-08-14", now_utc=_utc("2026-08-14T12:00:00"))
        assert len(new) == 1  # recorded despite no delivery
        assert conn.execute("SELECT COUNT(*) FROM alert_events").fetchone()[0] == 1
    finally:
        conn.close()


# ---- per-item metrics ----------------------------------------------------------


def test_platform_stale_metric(db, monkeypatch) -> None:
    """platform_stale = days PAST the platform's own threshold (brokers 2d).
    A 4-day-old position fires `ge 2`; a fresh one does not; the message names
    the platform."""
    conn = connect(db)
    try:
        _seed_position(conn, updated_at="2026-08-10T12:00:00+00:00")  # 4 days old
    finally:
        conn.close()
    sent: list[str] = []
    monkeypatch.setattr(engine_mod, "send_telegram", lambda text, **kw: sent.append(text) or True)

    conn = connect(db)
    try:
        rules = _rule(metric="platform_stale", op="ge", threshold=2.0)
        fired = engine_mod.evaluate(conn, rules, today="2026-08-14", now_utc=_utc("2026-08-14T12:00:00"))
        assert len(fired) == 1
        assert fired[0]["value"] == pytest.approx(2.0)  # 4 days old - 2d threshold
        assert fired[0]["label"] == "zerodha"
        assert "zerodha" in fired[0]["message"]

        # Fresh platform: age 1 -> 1 - 2 = -1 -> below the threshold -> no fire.
        conn.execute("DELETE FROM position")
        conn.commit()
        _seed_position(conn, updated_at="2026-08-13T12:00:00+00:00")
        assert engine_mod.evaluate(conn, rules, today="2026-08-14", now_utc=_utc("2026-08-14T12:00:00")) == []
    finally:
        conn.close()


def test_holding_return_metric_skips_costless_rows(db, monkeypatch) -> None:
    """holding_return_pct fires on the WORST holding (min for lt) and skips
    the M3 value-only rows (NULL cost) without crashing."""
    conn = connect(db)
    try:
        _seed_position(conn, ticker="LOSSY", cost_value_base=900.0, market_value_base=600.0)  # -33.3%
        _seed_position(conn, ticker="OKAY", cost_value_base=900.0, market_value_base=990.0)  # +10%
        _seed_position(conn, ticker="NOCOS T", cost_value_base=None, market_value_base=500.0)  # no cost
    finally:
        conn.close()

    conn = connect(db)
    try:
        rules = _rule(metric="holding_return_pct", op="lt", threshold=-25.0)
        fired = engine_mod.evaluate(conn, rules, today="2026-08-14", now_utc=_utc("2026-08-14T12:00:00"))
        assert len(fired) == 1
        assert fired[0]["value"] == pytest.approx(-33.3333, abs=1e-3)
        assert fired[0]["label"] == "LOSSY"
    finally:
        conn.close()


# ---- CLI --dry-run ---------------------------------------------------------------


def test_cli_dry_run_prints_sends_nothing_writes_nothing(db, monkeypatch, capsys) -> None:
    """(d) --dry-run: prints would-be alerts, NEVER calls send_telegram and
    NEVER writes alerts.json - the verification tool."""
    monkeypatch.setenv("PORTFOLIO_DB_PATH", str(db))
    monkeypatch.setattr(cli_mod, "_now_utc", lambda: _utc("2026-08-14T12:00:00+00:00"))
    monkeypatch.setattr(engine_mod, "load_rules", lambda path=None: _rule())
    sent: list[str] = []
    written: list[Path] = []
    monkeypatch.setattr(engine_mod, "send_telegram", lambda text, **kw: sent.append(text) or True)
    monkeypatch.setattr(
        engine_mod, "write_alerts_json",
        lambda fired, *, now_utc, path=None: written.append(path or Path("alerts.json")) or Path("x"),
    )

    conn = connect(db)
    try:
        _seed_position(conn, market_value_base=500.0)
    finally:
        conn.close()

    cli_mod.alerts(dry_run=True)  # must not raise

    assert sent == [] and written == []
    out = capsys.readouterr().out
    assert "would fire" in out and "Test rule" in out

    from portfolio.db import connect as _connect

    conn = _connect(db)
    assert conn.execute("SELECT COUNT(*) FROM alert_events").fetchone()[0] == 0
    conn.close()


def test_cli_alerts_default_sends_and_writes(db, monkeypatch, capsys) -> None:
    """The non-dry-run CLI path delivers (dedupe) and writes alerts.json."""
    monkeypatch.setenv("PORTFOLIO_DB_PATH", str(db))
    monkeypatch.setattr(cli_mod, "_now_utc", lambda: _utc("2026-08-14T12:00:00+00:00"))
    monkeypatch.setattr(engine_mod, "load_rules", lambda path=None: _rule())
    sent: list[str] = []
    written: list[Path] = []
    monkeypatch.setattr(engine_mod, "send_telegram", lambda text, **kw: sent.append(text) or True)
    monkeypatch.setattr(
        engine_mod, "write_alerts_json",
        lambda fired, *, now_utc, path=None: written.append(path or Path("alerts.json")) or Path("x"),
    )

    conn = connect(db)
    try:
        _seed_position(conn, market_value_base=500.0)
    finally:
        conn.close()

    cli_mod.alerts(dry_run=False)

    assert len(sent) == 1 and len(written) == 1
    assert "1 fired, 1 new sent" in capsys.readouterr().out
    conn = connect(db)
    assert conn.execute("SELECT COUNT(*) FROM alert_events").fetchone()[0] == 1
    conn.close()


# ---- M6 review MINORs: engine invariants ---------------------------------------


def test_malformed_rules_never_fire_never_crash(db) -> None:
    """(MINOR-3a) Unknown metric, bad op, string threshold, missing/empty id -
    every malformed shape yields [] fired and no exception (a broken rule is a
    no-op, never a pipeline failure)."""
    conn = connect(db)
    try:
        _seed_position(conn, market_value_base=500.0)  # would fire valid rules
    finally:
        conn.close()
    malformed = [
        {"name": "no id", "type": "portfolio", "metric": "total_value_base",
         "op": "lt", "threshold": 999.0},
        {"id": "", "name": "empty id", "metric": "total_value_base", "op": "lt", "threshold": 999.0},
        {"id": "unknown_metric", "name": "x", "metric": "moon_gravity", "op": "lt", "threshold": 1.0},
        {"id": "bad_op", "name": "x", "metric": "total_value_base", "op": "eq", "threshold": 999.0},
        {"id": "str_threshold", "name": "x", "metric": "total_value_base", "op": "lt", "threshold": "999"},
        {"id": "no_threshold", "name": "x", "metric": "total_value_base", "op": "lt"},
    ]
    conn = connect(db)
    try:
        # Any of these malformed rules would fire if misread (500 < 999): the
        # [] result proves every guard held.
        fired = engine_mod.evaluate(conn, malformed, today="2026-08-14", now_utc=_utc("2026-08-14T12:00:00"))
        assert fired == []
    finally:
        conn.close()


def test_day_pnl_pct_fx_conversion(db) -> None:
    """(MINOR-3b) USD day P&L converts to base with the pinned fx rate from
    ONE rate_date: pct = (day_pnl_ccy x rate) / total_base x 100."""
    conn = connect(db)
    try:
        _seed_position(conn, platform="zerodha", ticker="RELIANCE",
                       market_value_base=10_000.0, day_change_ccy=-100.0)
        _seed_position(conn, platform="moomoo", ticker="AAPL", currency="USD",
                       market_value_base=5_000.0, day_change_ccy=-50.0)
        conn.execute(
            "INSERT INTO fx_rate (rate_date, base, quote, source, rate, fetched_at)"
            " VALUES (?,?,?,?,?,?)",
            ("2026-08-14", "INR", "USD", "test", 95.0, "2026-08-14T12:00:00+00:00"),
        )
        conn.commit()
    finally:
        conn.close()

    conn = connect(db)
    try:
        rules = _rule(metric="day_pnl_pct", op="lt", threshold=0.0)
        fired = engine_mod.evaluate(conn, rules, today="2026-08-14", now_utc=_utc("2026-08-14T12:00:00"))
        assert len(fired) == 1
        expected = (-100.0 + -50.0 * 95.0) / 15_000.0 * 100.0  # -32.333...%
        assert fired[0]["value"] == pytest.approx(expected)
    finally:
        conn.close()


def test_day_pnl_pct_excludes_currency_without_rate(db, caplog) -> None:
    """(MINOR-3b) A currency with NO fx_rate is excluded with a warning -
    never fabricated at 1.0, never a crash. day_pnl_base stays 0 -> no fire."""
    conn = connect(db)
    try:
        _seed_position(conn, platform="moomoo", ticker="AAPL", currency="USD",
                       market_value_base=5_000.0, day_change_ccy=-50.0)
    finally:
        conn.close()

    conn = connect(db)
    try:
        rules = _rule(metric="day_pnl_pct", op="lt", threshold=0.0)
        with caplog.at_level("WARNING", logger="portfolio.alerts.engine"):
            fired = engine_mod.evaluate(conn, rules, today="2026-08-14", now_utc=_utc("2026-08-14T12:00:00"))
        assert fired == []  # excluded -> day_pnl_pct == 0.0, 0 < 0 is false
        assert any("no fx_rate for INR/USD" in r.getMessage() for r in caplog.records)
    finally:
        conn.close()