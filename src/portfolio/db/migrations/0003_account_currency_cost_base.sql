-- Migration 0003: account-currency display + cost basis in base currency (M2/M8 prep).
--
-- The dashboard shows each brokerage leg in its own currency (INR leg, SGD leg)
-- and the whole portfolio consolidated in the global base (INR). Two additions:
--
--   1. cost_value_base on position + position_snapshot: the cost basis converted
--      to the global base at the run's fx rate, so return% in base is computable
--      directly (cost_value_ccy alone is in the holding's own currency).
--   2. account.base_currency marks the DISPLAY currency of each account
--      (zerodha -> INR, moomoo -> SGD); the global consolidation base is
--      Settings.BASE_CURRENCY (INR), which is separate.

ALTER TABLE position ADD COLUMN cost_value_base REAL;

ALTER TABLE position_snapshot ADD COLUMN cost_value_base REAL;

-- Existing Moomoo account is a Singapore (FUTUSG) account: display in SGD.
UPDATE account SET base_currency = 'SGD' WHERE platform = 'moomoo' AND base_currency = 'INR';

PRAGMA user_version = 3;
