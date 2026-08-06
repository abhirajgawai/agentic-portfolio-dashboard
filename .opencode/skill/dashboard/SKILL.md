---
name: dashboard
description: The M8 React dashboard — JSON contract files it consumes, screens to build, and the chat/refresh bridge to the agent and pipeline services.
---

# Dashboard Skill (M8)

The dashboard is a read-only viewer + chat panel. It never calls broker MCPs directly.

## Static data (JSON contract, produced by the pipeline in `data/exports/`)
- `latest.json` — snapshot overview: `run_at, snapshot_date, fx_rate_to_base,
  net_worth_base {current, cost}, day_change_pct, holdings[] (common schema)`.
- `history.json` — `[{ date, net_worth_base, cash_base }]` per EOD for the area chart.
- `allocation.json` — `[{ label, value_base, pct, asset_class, geography }]` donut.
- `xirr.json` — `{ as_of, xirr_pct }` (and optional irr_pct series).
- `alerts.json` — `{ generated_at, alerts[] }` (rule_id, name, severity, message, ts).

The Dashboard fetches these as static JSON (Vite public/ or served by the pipeline
service). Exact field names are the contract — keep them stable across versions.

## Screens (Vite + React + TS strict + recharts)
1. Overview: net worth card, 1d/7d/30d change, allocation donut, last-run-status,
   session-health chips, count of active alerts.
2. Holdings table: sortable columns from common schema; base-currency values.
3. Value-over-time: recharts area chart from `history.json`.
4. Alerts panel: list with severity colors; empty state.
5. Agent chat: input → HTTP POST to the agent service → stream lines + cite tools used.
   "Refresh now" button → POST to pipeline service → re-fetch static JSON.

## Type conventions
- `src/types/contract.ts` mirrors the JSON with `readonly` fields for data types.
- `unknown`-guarded parsers, no `any` leaks. Strict TS, `noUncheckedIndexedAccess`.

## Local dev
- Vite dev server proxies `/api/*` → the agent + pipeline services. Dashboard must
  render from the fixture exports in `data/exports/` with zero network on offline dev.

## Tests / build
- `npm run build` (tsc) and `npm run lint` pass.
- Manual QA: each screen renders with representative fixture data; empty states
  handled (no holdings, no alerts, no history).