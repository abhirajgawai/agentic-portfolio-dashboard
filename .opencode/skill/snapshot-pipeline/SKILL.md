---
name: snapshot-pipeline
description: How one snapshot run is orchestrated — market-hours calendars, per-platform collection, FX, upsert, runs log, JSON export, and EOD mode. Use for M1-M4 pipeline work.
---

# Snapshot Pipeline Skill

A run collects holdings from all platforms into a single point-in-time snapshot.

## Orchestration (`src/portfolio/run.py`)
1. **Determine mode**: `eod` (market closed, is_eod=True) vs `live` (intraday).
2. **Calendar gate** (M4): skip platforms whose market is closed unless forced.
   - IN holidays: `data/holidays_in.csv`; US: `data/holidays_us.csv`.
   - Use exchange calendars (`trading_calendars`) for correctness.
3. **Session check** (per platform): token valid? else write a `runs` row
   (status `error`, e.g. "session expired") + Telegram.
4. **Collect**: for each platform, call allowlisted read-only MCP tools →
   normalizer → common schema rows.
5. **FX**: one rate per run (`fx.py`) → `current_value_base` for all rows.
6. **Upsert** into `snapshots` (UNIQUE(run_at, platform, ticker)), one `run_at` string
   shared by all rows in the run (determinism: same `run_at` → same rows).
7. **Log** a row in `runs`: `run_id, started_at, completed_at, status
   (success|partial|failed), platforms_collected, rows_count, fx_rate, triggered_by`.
8. **Export** JSON contract to `data/exports/` (see PLAN.md §5/M8): `latest.json`,
   `history.json`, `allocation.json`, `xirr.json`, `alerts.json`.

## CLI
- `uv run portfolio snapshot [--platform zerodha|moomoo|all] [--eod]`
- `uv run portfolio cas import <statement.pdf>` — monthly Groww/IN holdings (no broker
  session needed)
- `uv run portfolio trades [--platform zerodha|moomoo|all]` — daily XIRR capture
- `uv run portfolio status` — latest run + session health + staleness.

## Determinism
- Identical inputs (same `run_at`, same market data) → identical DB rows and exports.
- No LLM involvement anywhere in this path.

## Scheduling (M4)
- Windows Task Scheduler runs the CLI on market days around market close.
- Market-hours gate inside the pipeline protects against out-of-hours runs.
- In M9 this moves to a GitHub Actions cron.

## Tests
- Calendar gate: weekday+holiday → skip; market day → run.
- Upsert idempotency: running twice with same `run_at` yields no dupes.
- Export: JSON contract files valid and match the DB query results.