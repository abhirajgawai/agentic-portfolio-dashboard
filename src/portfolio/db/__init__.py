"""SQLite persistence for the portfolio pipeline (schema v2, relational).

Schema comes from versioned migrations in db/migrations/ (run `portfolio db migrate`).
Design split:
  STATE    position        - live holdings, one row per (account, instrument),
                             upserted IN PLACE every poll (never grows).
  HISTORY  position_snapshot, price_history, portfolio_value
                           - deliberate daily records: the returns backbone.
  MARKET   fx_rate         - one rate per (date, pair, source), shared via FK.
  EVENTS   trade           - cash flows for XIRR.
  AUDIT    runs            - one row per poll attempt; lineage parent for facts.
Dimensions account + instrument are the FK targets for all facts.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path


def connect(db_path: str | Path) -> sqlite3.Connection:
    """Open the portfolio DB with sane defaults. Single writer per plan (§3)."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
