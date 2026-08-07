"""Versioned migration runner.

`portfolio db migrate` is idempotent - safe to run every run start.

Migrations live in `migrations/NNNN_*.sql` and are applied in filename order.
Each script sets its own `PRAGMA user_version = NNNN` at the end, so a script
that fails midway leaves the version un-bumped and is retried (DDL uses
IF NOT EXISTS to survive a partial apply). `user_version` is the source of
truth for which migrations have already run.

Example: fresh DB -> applies 0001 (v1, for history) then 0002 (v2 relational).
Existing v1 DB (user_version=1) -> applies only 0002.
"""

from __future__ import annotations

import logging
import re
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

from portfolio.config import DB_PATH
from portfolio.db import connect

logger = logging.getLogger("portfolio.db.migrate")

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
_VERSION_RE = re.compile(r"^(\d+)_")

# A run can only be 'running' for the seconds it actually executes; anything
# older than this died mid-run (crash / kill) and is reconciled to 'error' so
# M4's failure visibility stays honest (MINOR-6).
STALE_RUNNING_AGE = timedelta(hours=6)


def _discover() -> list[tuple[int, Path]]:
    found: list[tuple[int, Path]] = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        match = _VERSION_RE.match(path.name)
        if not match:
            logger.warning("ignoring migration file without numeric prefix: %s", path.name)
            continue
        found.append((int(match.group(1)), path))
    return found


def _reconcile_stale_running(conn: sqlite3.Connection) -> None:
    """Flip 'running' runs older than 6h to 'error' (a dead process's last act).

    A crash mid-run leaves status='running' forever (single writer, so a live
    run is 'running' only briefly). Without this sweep the runs log would claim
    a run is still in flight days later. started_at is ISO-8601 UTC, so the
    string comparison is chronologically correct.
    """
    cutoff = (datetime.now(UTC) - STALE_RUNNING_AGE).isoformat()
    cur = conn.execute(
        "UPDATE runs SET status='error', error='stale running row reconciled'"
        " WHERE status='running' AND started_at < ?",
        (cutoff,),
    )
    conn.commit()
    if cur.rowcount:
        logger.warning("reconciled %d stale 'running' run(s) to 'error'", cur.rowcount)


def migrate(db_path: str | Path = DB_PATH) -> int:
    """Apply pending migrations. Returns the schema version now in effect."""
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = connect(db_path)
    try:
        current = conn.execute("PRAGMA user_version").fetchone()[0]
        for version, path in _discover():
            if version <= current:
                continue
            logger.info("applying migration %s (v%d)", path.name, version)
            conn.executescript(path.read_text(encoding="utf-8"))
            current = version
        _reconcile_stale_running(conn)
        logger.info("schema at v%d (db: %s)", current, db_path)
        return current
    except sqlite3.Error as exc:  # pragma: no cover - defensive
        logger.error("migration failed: %s", exc)
        raise
    finally:
        conn.close()
