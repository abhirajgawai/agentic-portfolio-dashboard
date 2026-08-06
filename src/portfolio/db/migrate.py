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
from pathlib import Path

from portfolio.config import DB_PATH
from portfolio.db import connect

logger = logging.getLogger("portfolio.db.migrate")

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
_VERSION_RE = re.compile(r"^(\d+)_")


def _discover() -> list[tuple[int, Path]]:
    found: list[tuple[int, Path]] = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        match = _VERSION_RE.match(path.name)
        if not match:
            logger.warning("ignoring migration file without numeric prefix: %s", path.name)
            continue
        found.append((int(match.group(1)), path))
    return found


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
        logger.info("schema at v%d (db: %s)", current, db_path)
        return current
    except sqlite3.Error as exc:  # pragma: no cover - defensive
        logger.error("migration failed: %s", exc)
        raise
    finally:
        conn.close()
