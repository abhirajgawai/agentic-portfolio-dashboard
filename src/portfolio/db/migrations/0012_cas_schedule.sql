-- Migration 0012: CAS request schedule (docs/CAMS_KFINTECH_CAS_PLAN.md, Part C).
--
-- UI-configurable cadence for the automated CAMS+KFintech CAS request, so the
-- interval can be changed from the dashboard without re-registering the
-- Windows Task Scheduler task. Singleton row (id=1): the scheduled task fires
-- frequently (e.g. daily) and `cams_cas_request.is_cas_request_due()` decides
-- whether it's actually time to act, based on interval_days and the most
-- recent successful platform='cams' `runs` row.
--
-- Default interval_days=2 per the user's explicit request. No market-hours
-- gating: CAS/MF folio data is not intraday, it only changes when the user
-- transacts, so there is nothing to gain from timing this around market
-- open/close (see plan doc §5.2).

CREATE TABLE IF NOT EXISTS cas_schedule (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    interval_days INTEGER NOT NULL DEFAULT 2 CHECK (interval_days > 0),
    enabled INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO cas_schedule (id, interval_days, enabled) VALUES (1, 2, 1);

PRAGMA user_version = 12;
