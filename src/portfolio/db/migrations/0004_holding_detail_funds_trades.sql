-- Migration 0004: full-fidelity holding detail + account funds + trade capture (M2.5).
--
-- Every broker's holdings payload carries day P&L / total P&L / prev close / etc.
-- that the UI needs but we previously discarded. We store BOTH a unified set of
-- normalized columns (fast queries) AND the full raw broker payload per holding
-- (raw_json - no field is ever lost again).
--
--   1. position + position_snapshot: unified day/P&L columns.
--   2. position (live state only): raw_json = the broker's full position dict.
--   3. instrument: exchange (+ existing isin now populated by normalizers).
--   4. account_funds: cash/assets per account per day (get_margins / get_funds).
--   5. trade: now written daily (get_trades / account_fills_history) for XIRR.

-- ---- unified day/P&L detail ------------------------------------------------

ALTER TABLE position ADD COLUMN prev_close REAL;
ALTER TABLE position ADD COLUMN day_change_ccy REAL;
ALTER TABLE position ADD COLUMN day_change_pct REAL;
ALTER TABLE position ADD COLUMN pnl_ccy REAL;
ALTER TABLE position ADD COLUMN pnl_pct REAL;
ALTER TABLE position ADD COLUMN realized_pnl_ccy REAL;
ALTER TABLE position ADD COLUMN unrealized_pnl_ccy REAL;
ALTER TABLE position ADD COLUMN can_sell_qty REAL;
ALTER TABLE position ADD COLUMN position_side TEXT;
ALTER TABLE position ADD COLUMN raw_json TEXT;

ALTER TABLE position_snapshot ADD COLUMN prev_close REAL;
ALTER TABLE position_snapshot ADD COLUMN day_change_ccy REAL;
ALTER TABLE position_snapshot ADD COLUMN day_change_pct REAL;
ALTER TABLE position_snapshot ADD COLUMN pnl_ccy REAL;
ALTER TABLE position_snapshot ADD COLUMN pnl_pct REAL;
ALTER TABLE position_snapshot ADD COLUMN realized_pnl_ccy REAL;
ALTER TABLE position_snapshot ADD COLUMN unrealized_pnl_ccy REAL;
ALTER TABLE position_snapshot ADD COLUMN can_sell_qty REAL;
ALTER TABLE position_snapshot ADD COLUMN position_side TEXT;

ALTER TABLE instrument ADD COLUMN exchange TEXT;

-- ---- account funds (cash / assets per account per day) ----------------------

CREATE TABLE IF NOT EXISTS account_funds (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id        INTEGER NOT NULL REFERENCES account(id),
    snapshot_date     TEXT NOT NULL,
    currency          TEXT NOT NULL,
    total_assets_ccy  REAL,
    market_value_ccy  REAL,
    cash_ccy          REAL,
    buying_power_ccy  REAL,
    fetched_at        TEXT NOT NULL,
    UNIQUE (account_id, snapshot_date, currency)
);

PRAGMA user_version = 4;
