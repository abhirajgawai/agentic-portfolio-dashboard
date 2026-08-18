-- Migration 0007: fix Zerodha day P&L stored as per-share instead of total.
--
-- Bug (found 2026-08-18): Kite's get_holdings `day_change` field is the
-- PER-SHARE price change (last_price - close_price); `pnl` is the position
-- total. The zerodha normalizer stored `day_change` verbatim into
-- day_change_ccy (whose contract is "day P&L in currency" = total), so the
-- dashboard summed ~35x too little: the Zerodha leg showed 658 while the
-- Zerodha app showed +15k, and sum(day_change * quantity) = 15,084.13 matched
-- the app exactly.
--
-- This backfills BOTH the live `position` state and the EOD `position_snapshot`
-- ledger rows for the zerodha account only. Each row's `quantity` is the
-- quantity the per-share day_change applied to (position: current; snapshot:
-- frozen at that day), so per-share x quantity is exact per row.
--
-- Moomoo's day_change_ccy is already a total (today_pl_val); groww/sharekhan/
-- real_estate rows carry no day P&L (NULL), so the platform filter is safe.
-- Safe only ONCE: the user_version gate guarantees this runs exactly once.
--
-- Also fix the old per-share day_change_pct semantics? NO - day_change_pct is a
-- RATIO (per-share % == position %), so it is unaffected by the bug.

UPDATE position
SET day_change_ccy = day_change_ccy * quantity
WHERE day_change_ccy IS NOT NULL
  AND account_id IN (SELECT id FROM account WHERE platform = 'zerodha');

UPDATE position_snapshot
SET day_change_ccy = day_change_ccy * quantity
WHERE day_change_ccy IS NOT NULL
  AND account_id IN (SELECT id FROM account WHERE platform = 'zerodha');

PRAGMA user_version = 7;