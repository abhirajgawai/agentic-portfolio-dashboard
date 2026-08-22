"""Goals CRUD (M8.9): migration applies, roundtrip, validation guards.

Small by design (tests earn their place): this pins the schema contract
(migration 0011 = the exact columns the dashboard frontend was built against)
and the two behaviors that are easy to silently regress - partial update
keeping untouched fields, and the friendly-vs-CHECK double validation of
target_amount.
"""

from __future__ import annotations

import math
import sqlite3

import pytest

import portfolio.goals as goals_mod
from portfolio.db import connect
from portfolio.db.migrate import migrate
from portfolio.goals import add_goal, delete_goal, list_goals, update_goal


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "t.db"
    migrate(path)
    return path


def test_migration_0011_creates_goal_table(tmp_path) -> None:
    path = tmp_path / "t.db"
    assert migrate(path) == 11
    conn = connect(path)
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(goal)").fetchall()}
    # Pinned contract: the dashboard frontend reads exactly these columns.
    assert cols == {
        "id", "label", "target_amount", "color", "crossed_at", "created_at", "updated_at",
    }
    # User chose start-empty: no seed rows.
    assert conn.execute("SELECT COUNT(*) FROM goal").fetchone()[0] == 0
    conn.close()


def test_crud_roundtrip(db) -> None:
    g1 = add_goal("Emergency fund", 500000.0, db_path=db)
    assert g1["id"] == 1
    assert g1["color"] == "#6f7cff"  # DEFAULT_COLOR applied
    assert g1["crossed_at"] is None
    assert g1["created_at"] == g1["updated_at"]

    g2 = add_goal("Car", 800000.0, color="#22c55e", db_path=db)
    assert [(g["id"], g["label"]) for g in list_goals(db_path=db)] == [
        (1, "Emergency fund"),
        (2, "Car"),
    ]

    # Partial update: only target changes; label/color survive untouched.
    upd = update_goal(g2["id"], target_amount=900000.0, db_path=db)
    assert upd["target_amount"] == 900000.0
    assert upd["label"] == "Car"
    assert upd["color"] == "#22c55e"

    assert delete_goal(g1["id"], db_path=db) is True
    assert delete_goal(g1["id"], db_path=db) is False  # already gone -> not an error
    assert [g["id"] for g in list_goals(db_path=db)] == [g2["id"]]


def test_update_refreshes_updated_at(db, monkeypatch) -> None:
    """updated_at must move even when the wall clock hasn't left the second."""
    ticks = iter([
        "2026-08-21T10:00:00+00:00",
        "2026-08-21T10:05:00+00:00",
    ])
    monkeypatch.setattr(goals_mod, "_now_iso", lambda: next(ticks))
    g = add_goal("Trip", 100000.0, db_path=db)
    upd = update_goal(g["id"], label="Japan trip", db_path=db)
    assert upd["created_at"] == "2026-08-21T10:00:00+00:00"
    assert upd["updated_at"] == "2026-08-21T10:05:00+00:00"


def test_target_validation_friendly_then_check(db) -> None:
    """Code guard gives readable errors; the DB CHECK backstops other writers."""
    for bad in (0.0, -5.0, math.inf, "100"):
        with pytest.raises(ValueError, match="target"):
            add_goal("Bad", bad, db_path=db)  # type: ignore[arg-type]
    # Bypassing the module hits the schema CHECK (defense in depth).
    conn = connect(db)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO goal (label, target_amount, created_at, updated_at)"
            " VALUES ('x', 0, 't', 't')"
        )
    conn.close()


def test_update_and_label_guards(db) -> None:
    g = add_goal("Trip", 100000.0, db_path=db)
    with pytest.raises(ValueError, match="nothing to update"):
        update_goal(g["id"], db_path=db)
    with pytest.raises(ValueError, match="not found"):
        update_goal(999, label="Ghost", db_path=db)
    with pytest.raises(ValueError, match="label"):
        add_goal("   ", 100.0, db_path=db)
