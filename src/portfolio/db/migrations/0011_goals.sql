-- Migration 0011: savings goals (M8.9).
--
-- Dashboard savings goals move out of browser localStorage into SQLite so they
-- survive browsers/devices and become readable by the pipeline (and later the
-- M7 agent). One row per goal; CRUD via portfolio.goals + `portfolio goal`.
--
-- Targets ONLY: no computed progress is ever stored. Progress = f(current
-- position values), derived at read time by the dashboard - storing a percent
-- would go stale with every price move and violate the derive-don't-write
-- rule (same lesson as portfolio_value in M3.5).
--
-- crossed_at: nullable ISO timestamp marking when the goal was reached; NULL
-- until something observes the crossing. created_at/updated_at are UTC ISO
-- (the repo-wide convention, microsecond-stripped).

CREATE TABLE IF NOT EXISTS goal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    target_amount REAL NOT NULL CHECK (target_amount > 0),
    color TEXT NOT NULL DEFAULT '#6f7cff',
    crossed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

PRAGMA user_version = 11;
