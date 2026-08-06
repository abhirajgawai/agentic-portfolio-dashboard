-- Migration 0002: v1 (wide per-run snapshot) -> v2 (state/history split).
--
-- The lesson of v1: a poll every 15 min for 8h would write 32 x holdings rows a day,
-- of which only the price changed. v2 separates:
--   STATE  (position)      live holdings, upserted IN PLACE. Grows 0 rows per poll.
--   HISTORY(position_snapshot, price_history, portfolio_value)
--                          deliberate daily records - the returns backbone.
--   MARKET DATA (fx_rate)  one rate per day, shared via FK.
--   EVENTS/AUDIT (trade, runs)
--
-- Data movement is guarded so the file is re-runnable after an interrupted apply.
-- Known limitation: `ALTER TABLE ... ADD COLUMN` has no IF NOT EXISTS in SQLite, so
-- a failure AFTER the ALTERs but before user_version bumps needs manual recovery
-- (delete the db and `portfolio db migrate` - dev data is re-pullable).

-- ---------------------------------------------------------------------------
-- DIMENSIONS (written once)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS account (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    platform       TEXT NOT NULL,
    account_ref    TEXT NOT NULL DEFAULT '',        -- broker account id if known
    label          TEXT NOT NULL,
    base_currency  TEXT NOT NULL DEFAULT 'INR',
    UNIQUE (platform, account_ref)
);

CREATE TABLE IF NOT EXISTS instrument (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    platform        TEXT NOT NULL,
    ticker          TEXT NOT NULL,
    isin            TEXT,
    name            TEXT,
    instrument_type TEXT,                            -- equity | etf | mutual_fund (nullable until classified)
    geography       TEXT,
    currency        TEXT NOT NULL,
    sector          TEXT,
    asset_class     TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (platform, ticker)
);

-- ---------------------------------------------------------------------------
-- MARKET DATA
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fx_rate (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    rate_date  TEXT NOT NULL,
    base       TEXT NOT NULL,
    quote      TEXT NOT NULL,
    source     TEXT NOT NULL,
    rate       REAL NOT NULL,
    fetched_at TEXT NOT NULL,
    UNIQUE (rate_date, base, quote, source)
);

-- EOD closes only (live prices are fetched on demand over MCP, not stored).
CREATE TABLE IF NOT EXISTS price_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    instrument_id INTEGER NOT NULL REFERENCES instrument(id),
    price_date    TEXT NOT NULL,
    close         REAL NOT NULL,
    currency      TEXT NOT NULL,
    UNIQUE (instrument_id, price_date)
);

-- ---------------------------------------------------------------------------
-- AUDIT (lineage parent for facts)
-- ---------------------------------------------------------------------------

ALTER TABLE runs ADD COLUMN snapshot_date TEXT;
ALTER TABLE runs ADD COLUMN is_eod INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- STATE (live, one row per holding - upserted in place, never accumulates)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS position (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id        INTEGER NOT NULL REFERENCES account(id),
    instrument_id     INTEGER NOT NULL REFERENCES instrument(id),
    quantity          REAL NOT NULL,
    avg_cost          REAL,
    price             REAL NOT NULL,                 -- latest LTP from the last poll
    cost_value_ccy    REAL,
    market_value_ccy  REAL NOT NULL,
    market_value_base REAL NOT NULL,                 -- at the poll's fx rate
    updated_at        TEXT NOT NULL,                 -- UTC ISO-8601
    UNIQUE (account_id, instrument_id)
);

-- ---------------------------------------------------------------------------
-- HISTORY (one row per holding per day - the daily ledger for returns)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS position_snapshot (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id            INTEGER REFERENCES runs(id),   -- which run wrote the day's record
    account_id        INTEGER NOT NULL REFERENCES account(id),
    instrument_id     INTEGER NOT NULL REFERENCES instrument(id),
    fx_rate_id        INTEGER REFERENCES fx_rate(id),
    snapshot_date     TEXT NOT NULL,                 -- YYYY-MM-DD (local market date)
    quantity          REAL NOT NULL,
    avg_cost          REAL,
    price             REAL NOT NULL,
    cost_value_ccy    REAL,
    market_value_ccy  REAL NOT NULL,
    market_value_base REAL NOT NULL,                 -- frozen at the run's fx rate
    UNIQUE (snapshot_date, account_id, instrument_id)
);

-- Compact value series for charts / YoY / day-on-day. scope_type: all|geography|platform
CREATE TABLE IF NOT EXISTS portfolio_value (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    value_date  TEXT NOT NULL,                       -- YYYY-MM-DD
    is_eod      INTEGER NOT NULL DEFAULT 0,
    scope_type  TEXT NOT NULL,                       -- all | geography | platform
    scope_key   TEXT NOT NULL DEFAULT '',            -- '' | US | zerodha ...
    value_base  REAL NOT NULL,
    UNIQUE (value_date, is_eod, scope_type, scope_key)
);

-- ---------------------------------------------------------------------------
-- EVENTS (cash flows for XIRR)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trade (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id        INTEGER REFERENCES runs(id),
    account_id    INTEGER NOT NULL REFERENCES account(id),
    instrument_id INTEGER NOT NULL REFERENCES instrument(id),
    trade_date    TEXT NOT NULL,
    quantity      REAL NOT NULL,                     -- signed: +buy / -sell
    price         REAL NOT NULL,
    amount_ccy    REAL NOT NULL,                     -- signed amount (currency)
    currency      TEXT NOT NULL,
    external_id   TEXT,                              -- broker trade id (dedupe)
    UNIQUE (account_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_position_snapshot_date ON position_snapshot (snapshot_date);
CREATE INDEX IF NOT EXISTS idx_position_snapshot_inst ON position_snapshot (instrument_id);
CREATE INDEX IF NOT EXISTS idx_price_history_date     ON price_history (price_date);
CREATE INDEX IF NOT EXISTS idx_portfolio_value_date   ON portfolio_value (value_date);

-- ---------------------------------------------------------------------------
-- BACKFILL v1 -> v2 (guarded: run at most once)
-- ---------------------------------------------------------------------------

-- runs: the v1 run key (started_at) equals the v1 snapshot run key (run_at).
UPDATE runs
SET snapshot_date = (SELECT MIN(s.snapshot_date) FROM snapshots s WHERE s.run_at = runs.started_at)
WHERE snapshot_date IS NULL;

-- account: one per platform seen.
INSERT INTO account (platform, label)
SELECT DISTINCT platform, platform FROM snapshots
WHERE NOT EXISTS (SELECT 1 FROM account);

-- instrument: distinct (platform, ticker), MIN() of stable-ish attributes.
INSERT INTO instrument (platform, ticker, name, geography, currency, sector, asset_class)
SELECT platform, ticker, MIN(name), MIN(geography), MIN(currency), MIN(sector), MIN(asset_class)
FROM snapshots
WHERE NOT EXISTS (SELECT 1 FROM instrument)
GROUP BY platform, ticker;

-- fx_rate: carry over any v1 rows (none today - INR only, so the table stays empty).
INSERT INTO fx_rate (rate_date, base, quote, source, rate, fetched_at)
SELECT rate_date, base, quote, source, rate, fetched_at FROM fx_rates
WHERE NOT EXISTS (SELECT 1 FROM fx_rate);

-- position (live state): the latest v1 run only.
INSERT INTO position
    (account_id, instrument_id, quantity, avg_cost, price,
     cost_value_ccy, market_value_ccy, market_value_base, updated_at)
SELECT a.id, i.id, s.quantity, s.avg_price, s.current_price,
       s.cost_basis, s.current_value, s.current_value_base, s.run_at
FROM snapshots s
JOIN account a    ON a.platform = s.platform
JOIN instrument i ON i.platform = s.platform AND i.ticker = s.ticker
WHERE s.run_at = (SELECT MAX(run_at) FROM snapshots)
  AND NOT EXISTS (SELECT 1 FROM position);

-- position_snapshot (daily ledger): the latest v1 run per holding+date.
-- UNIQUE(snapshot_date, account, instrument) => keep only the newest of today's runs.
INSERT INTO position_snapshot
    (run_id, account_id, instrument_id, fx_rate_id, snapshot_date,
     quantity, avg_cost, price, cost_value_ccy, market_value_ccy, market_value_base)
SELECT r.id, a.id, i.id, NULL, s.snapshot_date,
       s.quantity, s.avg_price, s.current_price, s.cost_basis, s.current_value, s.current_value_base
FROM snapshots s
JOIN runs r       ON r.started_at = s.run_at
JOIN account a    ON a.platform = s.platform
JOIN instrument i ON i.platform = s.platform AND i.ticker = s.ticker
WHERE s.run_at = (SELECT MAX(run_at) FROM snapshots)
  AND NOT EXISTS (SELECT 1 FROM position_snapshot);

-- price_history (EOD closes): dedupe the two same-day runs via GROUP BY.
INSERT INTO price_history (instrument_id, price_date, close, currency)
SELECT i.id, s.snapshot_date, s.current_price, s.currency
FROM snapshots s
JOIN instrument i ON i.platform = s.platform AND i.ticker = s.ticker
WHERE NOT EXISTS (SELECT 1 FROM price_history)
GROUP BY i.id, s.snapshot_date;

-- portfolio_value: total per date from the latest run (both today's runs share a date).
INSERT INTO portfolio_value (value_date, is_eod, scope_type, scope_key, value_base)
SELECT snapshot_date, 0, 'all', '', SUM(current_value_base)
FROM snapshots
WHERE run_at = (SELECT MAX(run_at) FROM snapshots)
  AND NOT EXISTS (SELECT 1 FROM portfolio_value)
GROUP BY snapshot_date;

-- ---------------------------------------------------------------------------
-- DROP v1 (data now lives in the v2 tables)
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS snapshots;
DROP TABLE IF EXISTS fx_rates;
DROP TABLE IF EXISTS trades;

PRAGMA user_version = 2;
