"""M8.9 goals.json export: pinned shape + crossing-stamp idempotency.

Small by design (tests earn their place): these guard the three behaviors the
dashboard interlock depends on -
  1. goals.json ALWAYS exists after an export (empty table -> "goals": []),
     with valueBase IDENTICAL to latest.json's totals.valueBase;
  2. a crossing is stamped EXACTLY ONCE across consecutive exports (pinned
     clock: the second export runs an hour later - a buggy re-stamp would
     move crossedAt and fail);
  3. goals above target keep crossedAt NULL forever.

The script lives in scripts/ (not a package - the bridge/scheduler run it as
a plain file), so it is loaded here via importlib from its path. Every OUT_*
constant is redirected to tmp_path FIRST: no test may ever write the real
dashboard/public/data/ exports.
"""

from __future__ import annotations

import importlib.util
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from portfolio.db import connect, writer
from portfolio.db.migrate import migrate
from portfolio.goals import add_goal

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export_json.py"

_OUT_NAMES = ("OUT", "OUT_HISTORY", "OUT_XIRR", "OUT_ALERTS", "OUT_PERF", "OUT_GOALS")


def _load_module():
    spec = importlib.util.spec_from_file_location("export_json_under_test", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def mod(tmp_path, monkeypatch):
    """The export script with every output file pointed at tmp_path."""
    m = _load_module()
    for name in _OUT_NAMES:
        monkeypatch.setattr(m, name, tmp_path / f"{name.lower()}.json")
    return m


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "t.db"
    migrate(path)
    return path


def _seed_position(db, value_base: float) -> None:
    """One live INR position worth exactly value_base (the writer helpers the
    real pipeline uses - no SQL shortcuts)."""
    conn = connect(db)
    try:
        acc = writer.ensure_account(conn, "zerodha", account_ref="ACC-T", base_currency="INR")
        inst = writer.ensure_instrument(
            conn, "zerodha", "TESTEQ", currency="INR", geography="IN", name="Test Eq"
        )
        writer.upsert_position(
            conn, acc, inst,
            quantity=1.0, avg_cost=None, price=value_base,
            cost_value_ccy=None, market_value_ccy=value_base,
            market_value_base=value_base, cost_value_base=None,
            updated_at="2026-08-21T09:00:00+00:00",
        )
    finally:
        conn.close()


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _crossed_at(db, goal_id: int) -> str | None:
    conn = connect(db)
    try:
        return conn.execute(
            "SELECT crossed_at FROM goal WHERE id = ?", (goal_id,)
        ).fetchone()["crossed_at"]
    finally:
        conn.close()


def test_goals_json_written_even_when_table_empty(db, mod, tmp_path):
    """Empty goal table still writes the file - the dashboard and
    check-contract depend on its existence."""
    out = mod.export(db_path=db, out=tmp_path / "latest.json")

    goals = _read(mod.OUT_GOALS)
    assert set(goals) == {"asOf", "valueBase", "goals"}
    assert goals["goals"] == []
    assert isinstance(goals["asOf"], str) and goals["asOf"]
    # valueBase identity: the SAME number latest.json carries.
    latest = _read(out)
    assert goals["valueBase"] == latest["totals"]["valueBase"] == 0.0


def test_crossing_stamped_exactly_once_across_two_exports(db, mod, tmp_path, monkeypatch):
    """target <= valueBase AND crossed_at IS NULL -> stamped once; the second
    export (clock moved +1h) must change NOTHING."""
    _seed_position(db, 1_000_000.0)
    crossed = add_goal("Cross me", 500_000.0, db_path=db)

    stamps = iter([
        datetime(2026, 8, 21, 10, 0, 0, tzinfo=UTC),
        datetime(2026, 8, 21, 11, 0, 0, tzinfo=UTC),
    ])
    monkeypatch.setattr(mod, "_utcnow", lambda: next(stamps))

    mod.export(db_path=db, out=tmp_path / "latest.json")
    first = _read(mod.OUT_GOALS)
    assert first["valueBase"] == 1_000_000.0
    [g] = first["goals"]
    assert g["id"] == crossed["id"]
    assert g["label"] == "Cross me"
    assert g["targetAmount"] == 500_000.0
    assert g["color"] == "#6f7cff"
    assert g["crossedAt"] == "2026-08-21T10:00:00+00:00"
    assert _crossed_at(db, crossed["id"]) == "2026-08-21T10:00:00+00:00"

    mod.export(db_path=db, out=tmp_path / "latest.json")
    second = _read(mod.OUT_GOALS)
    [g2] = second["goals"]
    assert g2["crossedAt"] == "2026-08-21T10:00:00+00:00"  # unchanged despite +1h clock
    assert _crossed_at(db, crossed["id"]) == "2026-08-21T10:00:00+00:00"


def test_goal_above_target_stays_null_across_exports(db, mod, tmp_path):
    """A goal above the portfolio total keeps crossedAt NULL - equality counts
    as crossed (<=), strictly-above never stamps."""
    _seed_position(db, 1_000_000.0)
    exact = add_goal("Exactly at target", 1_000_000.0, db_path=db)
    above = add_goal("Far above", 2_000_000.0, db_path=db)

    for _ in range(2):  # two exports: null-ness must be stable
        mod.export(db_path=db, out=tmp_path / "latest.json")
        payload = _read(mod.OUT_GOALS)
        by_id = {g["id"]: g for g in payload["goals"]}
        assert by_id[exact["id"]]["crossedAt"] is not None  # <= boundary crosses
        assert by_id[above["id"]]["crossedAt"] is None
