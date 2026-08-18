-- Migration 0010: daily performance layer (M8.6).
--
-- A derived, materialized view over position_snapshot so the MCP tool layer and
-- the dashboard can read day P&L / returns / attribution without re-running the
-- interval-rule derivation. Written ONLY by the table rebuild helper
-- (portfolio.performance.rebuild_table) at export time: DELETE-all + INSERT,
-- idempotent and deterministic (UNIQUE (perf_date, scope_type, scope_key) is the
-- no-dupe backstop; the DELETE-first pattern makes a second rebuild identical).
--
-- Scope rows: one row per (perf_date, scope_type, scope_key) for
--   scope_type in 'all' | 'geography' | 'platform' | 'asset_class' | 'currency'.
--   day_pnl_base  = interval-rule daily moves ONLY (revaluations excluded).
--   broker_day_pnl_base = live-leg (zerodha/moomoo) day_change_ccy converted to
--                         base with each row's own frozen value ratio (NULL when
--                         the scope has no broker-reported day P&L).
--   fx_rate_id    = the first fx_rate row dated perf_date (nullable - INR-only
--                   days have no rate rows; the values are already in base).

CREATE TABLE IF NOT EXISTS daily_performance (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    perf_date          TEXT NOT NULL,
    scope_type         TEXT NOT NULL,
    scope_key          TEXT NOT NULL DEFAULT '',
    value_base         REAL NOT NULL,
    day_pnl_base       REAL NOT NULL,
    broker_day_pnl_base REAL,
    day_pnl_pct        REAL,
    simple_return_pct  REAL,
    cost_with          INTEGER NOT NULL DEFAULT 0,
    cost_without       INTEGER NOT NULL DEFAULT 0,
    fx_rate_id         INTEGER REFERENCES fx_rate(id),
    rebuilt_at         TEXT NOT NULL,
    UNIQUE (perf_date, scope_type, scope_key)
);
CREATE INDEX IF NOT EXISTS idx_daily_perf_date ON daily_performance (perf_date);

PRAGMA user_version = 10;
