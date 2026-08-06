---
name: alerts-engine
description: Rule-based alerts evaluated after each snapshot — thresholds, anomalies, dedupe, and Telegram delivery. Use for M6 work.
---

# Alerts Engine Skill

## Rules (declarative, `data/rules.yaml`)
```yaml
alerts:
  - id: value_drop
    name: "Portfolio value drop"
    type: snapshot
    condition: "current_value_base < threshold_90d * 0.95"
    severity: warn
  - id: sector_concentration
    name: "Sector concentration breach"
    type: allocation
    condition: "sector_allocation['IT'] > 0.40"
    severity: info
  - id: stale_session
    name: "Broker session expired"
    type: session
    condition: "zerodha.session == 'expired'"
    severity: warn
```

## Engine (`src/portfolio/alerts.py`)
- After each snapshot run, evaluate every rule against the snapshot + trades + sessions.
- Conditions are small pure functions; rules are data, not code, where possible.

## Dedupe
- An alert fires at most once per `(rule_id, alert_key)` per day. `alert_key` is a
  stable digest of the triggering values (e.g. `value_drop:2026-08-06`), so the same
  condition across runs does not spam Telegram.

## Delivery (Telegram)
- Bot token in `data/tokens.json` under `telegram`. Channel/chat_id configured in
  `data/config.yaml`.
- Deduped alerts are batched into ONE message per run. Include: rule name, severity,
  current value, threshold, timestamp.
- Failures to send are logged and retried once.

## Output
- `data/exports/alerts.json`: `{ generated_at, alerts: [...] }` for the dashboard.

## Tests
- Rule triggers exactly when condition holds; dedupe suppresses repeats; batching
  sends one message per run (assert against a mock Telegram sender).