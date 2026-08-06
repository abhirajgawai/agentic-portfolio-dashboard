-- Migration 0001: original v1 schema (PLAN.md §4/§5). Applied by `portfolio db migrate`.
-- Kept verbatim so fresh installs replay the exact v1 history before 0002 rewrites it.

CREATE TABLE IF NOT EXISTS snapshots (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at               TEXT NOT NULL,             -- UTC ISO-8601
    snapshot_date        TEXT NOT NULL,             -- YYYY-MM-DD (local market date)
    platform             TEXT NOT NULL,             -- zerodha | groww | moomoo
    geography            TEXT NOT NULL,             -- IN | US
    ticker               TEXT NOT NULL,
    name                 TEXT,
    quantity             REAL NOT NULL,
    avg_price            REAL,
    current_price        REAL NOT NULL,
    cost_basis           REAL,
    current_value        REAL NOT NULL,             -- in holding currency
    currency             TEXT NOT NULL,             -- INR | USD
    sector               TEXT,
    asset_class          TEXT,
    fx_rate_to_base      REAL,                      -- rate applied this run
    current_value_base   REAL,                      -- converted to base currency
    is_eod               INTEGER NOT NULL DEFAULT 0,
    UNIQUE (run_at, platform, ticker)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_date ON snapshots (snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_ticker ON snapshots (ticker, snapshot_date);

CREATE TABLE IF NOT EXISTS fx_rates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    rate_date   TEXT NOT NULL,                      -- YYYY-MM-DD
    base        TEXT NOT NULL,
    quote       TEXT NOT NULL,
    source      TEXT NOT NULL,                      -- e.g. open.er-api.com
    rate        REAL NOT NULL,
    fetched_at  TEXT NOT NULL,                      -- UTC ISO-8601
    UNIQUE (rate_date, base, quote, source)
);

CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    platform    TEXT NOT NULL,                      -- zerodha | groww | moomoo | all
    started_at  TEXT NOT NULL,                      -- UTC ISO-8601
    status      TEXT NOT NULL,                      -- ok | skipped | error
    rows        INTEGER NOT NULL DEFAULT 0,
    error       TEXT,
    UNIQUE (platform, started_at)
);

CREATE TABLE IF NOT EXISTS trades (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date   TEXT NOT NULL,                     -- YYYY-MM-DD (local market date)
    platform     TEXT NOT NULL,
    ticker       TEXT NOT NULL,
    name         TEXT,
    quantity     REAL NOT NULL,                     -- signed: +buy / -sell
    price        REAL NOT NULL,                     -- execution price in currency
    amount       REAL NOT NULL,                     -- signed amount (currency)
    currency     TEXT NOT NULL,
    geography    TEXT NOT NULL,
    external_id  TEXT,                              -- broker trade id (dedupe)
    captured_at  TEXT NOT NULL,                     -- UTC ISO-8601
    UNIQUE (platform, external_id)
);

PRAGMA user_version = 1;
