"""Savings goals CRUD (M8.9).

The dashboard's journey goals used to live in browser localStorage (lost on
device/browser change, invisible to the pipeline). They now live in the
`goal` table (migration 0011) behind these functions and the `portfolio goal`
CLI group.

Scope discipline:
- Targets ONLY. Progress toward a goal is derived at read time from position
  values by the dashboard - never computed or stored here (derive-don't-write,
  the M3.5 portfolio_value lesson). crossed_at is also outside this module's
  writes: something must OBSERVE the crossing first.
- Deterministic pipeline code: no LLM, no network, no secrets.

Conventions (mirroring property_import.py):
- Every public function takes db_path (default config.DB_PATH) and calls
  migrate() first - idempotent, so goals work on a fresh DB.
- Timestamps are UTC ISO with microseconds stripped.
- Rows are returned as plain dicts (id, label, target_amount, color,
  crossed_at, created_at, updated_at).
"""

from __future__ import annotations

import math
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from portfolio.config import DB_PATH

DEFAULT_COLOR = "#6f7cff"

_GOAL_COLS = "id, label, target_amount, color, crossed_at, created_at, updated_at"


def _now_iso() -> str:
    """UTC ISO timestamp, microseconds stripped (property_import convention).

    Module-level seam so tests can pin the clock (the repo's determinism
    habit: the operation under test never hides a clock read inside).
    """
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _validate_target(target_amount: Any) -> float:
    """Friendly code-level guard for target_amount (> 0, finite, numeric).

    The schema CHECK (target_amount > 0) is the DB-level backstop for writers
    that bypass this module; this gives HUMANS a readable error instead of a
    raw sqlite3.IntegrityError. isfinite rejects inf, which would pass both
    `> 0` checks yet poison every progress calculation downstream.
    """
    if isinstance(target_amount, bool) or not isinstance(target_amount, (int, float)):
        raise ValueError(f"target must be a number, got {type(target_amount).__name__}")
    amount = float(target_amount)
    if not math.isfinite(amount) or amount <= 0:
        raise ValueError(f"target must be greater than 0, got {target_amount}")
    return amount


def _validate_label(label: str) -> str:
    cleaned = (label or "").strip()
    if not cleaned:
        raise ValueError("label must not be empty")
    return cleaned


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def _connect(db_path: str | Path) -> sqlite3.Connection:
    from portfolio.db import connect

    return connect(db_path)


def add_goal(
    label: str,
    target_amount: float,
    color: str | None = None,
    *,
    db_path: str | Path = DB_PATH,
) -> dict[str, Any]:
    """Create a goal. Returns the full row as a dict."""
    from portfolio.db.migrate import migrate

    migrate(db_path)  # idempotent - goals must work on a fresh DB
    clean_label = _validate_label(label)
    amount = _validate_target(target_amount)
    now = _now_iso()
    conn = _connect(db_path)
    try:
        cur = conn.execute(
            "INSERT INTO goal (label, target_amount, color, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (clean_label, amount, color or DEFAULT_COLOR, now, now),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {_GOAL_COLS} FROM goal WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


def list_goals(*, db_path: str | Path = DB_PATH) -> list[dict[str, Any]]:
    """All goals in creation order (by id - stable and deterministic)."""
    from portfolio.db.migrate import migrate

    migrate(db_path)
    conn = _connect(db_path)
    try:
        rows = conn.execute(f"SELECT {_GOAL_COLS} FROM goal ORDER BY id").fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def get_goal(goal_id: int, *, db_path: str | Path = DB_PATH) -> dict[str, Any] | None:
    """One goal by id, or None when absent."""
    from portfolio.db.migrate import migrate

    migrate(db_path)
    conn = _connect(db_path)
    try:
        row = conn.execute(
            f"SELECT {_GOAL_COLS} FROM goal WHERE id = ?", (goal_id,)
        ).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def update_goal(
    goal_id: int,
    label: str | None = None,
    target_amount: float | None = None,
    color: str | None = None,
    *,
    db_path: str | Path = DB_PATH,
) -> dict[str, Any]:
    """Partial update: only the given fields change; updated_at always refreshes.

    Raises ValueError when the goal doesn't exist, nothing was passed, or a
    passed value is invalid (same friendly-error channel as add_goal).
    """
    from portfolio.db.migrate import migrate

    migrate(db_path)
    fields: dict[str, Any] = {}
    if label is not None:
        fields["label"] = _validate_label(label)
    if target_amount is not None:
        fields["target_amount"] = _validate_target(target_amount)
    if color is not None:
        fields["color"] = color
    if not fields:
        raise ValueError("nothing to update - pass at least one of label/target/color")

    conn = _connect(db_path)
    try:
        exists = conn.execute("SELECT 1 FROM goal WHERE id = ?", (goal_id,)).fetchone()
        if not exists:
            raise ValueError(f"goal {goal_id} not found")
        sets = ", ".join(f"{name} = ?" for name in fields)
        params = [*fields.values(), _now_iso(), goal_id]
        conn.execute(f"UPDATE goal SET {sets}, updated_at = ? WHERE id = ?", params)
        conn.commit()
        row = conn.execute(
            f"SELECT {_GOAL_COLS} FROM goal WHERE id = ?", (goal_id,)
        ).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


def delete_goal(goal_id: int, *, db_path: str | Path = DB_PATH) -> bool:
    """Delete a goal. True when a row was removed, False when it didn't exist."""
    from portfolio.db.migrate import migrate

    migrate(db_path)
    conn = _connect(db_path)
    try:
        cur = conn.execute("DELETE FROM goal WHERE id = ?", (goal_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()
