"""Fresh-start data reset — truncate every financial-data table, keep schema.

Deletes rows only (no DROP, no migration rollback); `goal` and `cas_schedule`
are deliberately excluded — they're user config/scheduling state, not
portfolio data, and wiping cas_schedule would make the CAMS+KFintech
every-2-days gate think it has never run.

Order matters even though this project's SQLite connections don't turn on
`PRAGMA foreign_keys` (so it isn't strictly enforced today): children are
deleted before parents so this stays correct if that ever changes.
"""

from __future__ import annotations

import logging
from pathlib import Path

from portfolio.config import DB_PATH
from portfolio.db import connect

logger = logging.getLogger("portfolio.db.reset")

_TRUNCATE_ORDER = (
    "position_snapshot",
    "position",
    "trade",
    "account_funds",
    "alert_events",
    "daily_performance",
    "price_history",
    "portfolio_value",
    "runs",
    "instrument",
    "fx_rate",
    "account",
    # v1 legacy tables (superseded by the v2 relational schema, unread by any
    # code path today, but truncated too for a genuinely clean slate).
    "snapshots",
    "fx_rates",
    "trades",
)

KEPT_TABLES = ("goal", "cas_schedule")


def truncate_all(db_path: str | Path = DB_PATH) -> dict[str, int]:
    """Delete all rows from every table in _TRUNCATE_ORDER that exists in the
    current schema. Returns {table: rows_deleted}. Idempotent - safe to run
    on an already-empty DB."""
    from portfolio.db.migrate import migrate

    migrate(db_path)  # ensure schema is current before we touch it
    conn = connect(db_path)
    counts: dict[str, int] = {}
    try:
        for table in _TRUNCATE_ORDER:
            exists = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
            if not exists:
                continue
            cur = conn.execute(f"DELETE FROM {table}")  # noqa: S608 - table from a fixed constant tuple, never user input
            counts[table] = cur.rowcount
        conn.commit()
        conn.execute("VACUUM")
    finally:
        conn.close()
    logger.info("truncated %d rows across %d tables", sum(counts.values()), len(counts))
    return counts
