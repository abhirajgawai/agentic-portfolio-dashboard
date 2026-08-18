-- Migration 0008: remove property terminal as-if-sold trades (XIRR double-count).
--
-- property_import (M8.5) used to write a terminal trade (amount_ccy =
-- -current_valuation) on the valuation date AND account_xirrs adds the
-- position's current value as a terminal flow - the SAME liquidation counted
-- twice, inflating the property XIRR. Live proof 2026-08-18:
-- TALOJA_PROPERTY showed 18.06% XIRR; the honest rate (purchase 3.2M on
-- 2022-12-12, terminal 3.5M) is ~2.46%. The stale terminal trade was also
-- never updated on re-valuation (upsert deduped by external_id + date).
--
-- The terminal is now DERIVED from the position (account_xirrs generic
-- terminal); purchase + improvement trades remain. Only property terminal
-- trades are deleted (external_id LIKE 'terminal_%', real_estate account) -
-- no other writer uses that prefix. Runs once via the user_version gate.

DELETE FROM trade
WHERE external_id LIKE 'terminal_%'
  AND account_id IN (SELECT id FROM account WHERE platform = 'real_estate');

PRAGMA user_version = 8;