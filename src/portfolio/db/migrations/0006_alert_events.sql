-- Migration 0006: rule alert events (M6) - the dedupe backbone.
--
-- M6 alerts are rule-based and evaluated after each snapshot export
-- (scripts/export_json.py + `portfolio alerts`). The dedupe contract is ONE
-- event per (rule, trading day): UNIQUE(rule_id, event_date) + the evaluator's
-- ON CONFLICT DO NOTHING insert means a re-run the same day (retries, the
-- 15:55 export + a manual `portfolio alerts`) never re-sends or re-records.
--
-- event_date is the Asia/Kolkata market date (the ledger's date convention,
-- NIT-2); created_at is the UTC evaluation instant. severity is
-- info | warn | critical; message is the human-readable fired text.

CREATE TABLE IF NOT EXISTS alert_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id     TEXT NOT NULL,               -- rule id from data/rules.yaml
    event_date  TEXT NOT NULL,               -- YYYY-MM-DD (Asia/Kolkata)
    severity    TEXT,                        -- info | warn | critical
    message     TEXT,                        -- human-readable fired message
    created_at  TEXT NOT NULL,               -- UTC ISO-8601
    UNIQUE (rule_id, event_date)
);

CREATE INDEX IF NOT EXISTS idx_alert_events_date ON alert_events (event_date);

PRAGMA user_version = 6;
