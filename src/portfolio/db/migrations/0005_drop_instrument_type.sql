-- Migration 0005: drop the never-populated instrument.instrument_type column.
--
-- Verified by grep (2026-08-07, NIT-1): nothing writes or reads
-- instrument_type; asset_class (equity | etf | mutual_fund) is the populated
-- classifier. SQLite DROP COLUMN requires >= 3.35 (bundled: 3.50.4); the column
-- has no index or generated-column dependency, so the drop is safe.

ALTER TABLE instrument DROP COLUMN instrument_type;

PRAGMA user_version = 5;
