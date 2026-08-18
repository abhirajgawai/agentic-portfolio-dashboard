---
name: dashboard
description: The M8 React dashboard — JSON contract files it consumes, screens to build, and the chat/refresh bridge to the agent and pipeline services.
---

# Dashboard Skill (M8)

The dashboard is a read-only viewer + chat panel. It never calls broker MCPs directly.

## Static data (JSON contract, produced by the pipeline in `dashboard/public/data/`)
- `latest.json` — snapshot overview: `asOf, baseCurrency, fx, platforms (staleness),
  totals {valueBase, dayPnl, byAccountCurrency}, allocation {byGeography, byPlatform,
  bySector, byAssetClass, byAccountCurrency}, holdings[] (common schema)`.
- `history.json` — `{ dates[], portfolioValueBase[], byGeography{}, byPlatform{} }`
  per EOD for the area chart (the derived ledger, M-3).
- `xirr.json` — `{ asOf, perAccount: { "<platform>__<id>": {currency, xirrPct, terminalValue, flowCount} }, estimated }`.
- `alerts.json` — `{ generatedAt, alerts[] }` (ruleId, severity, message).

The Dashboard fetches these as static JSON (Vite public/ or served by the pipeline
service). Exact field names are the contract — keep them stable across versions.
The Zod schemas in `src/types/contract.ts` ARE the contract (validated at runtime +
by `npm run check:contract`).

## Screens (Vite + React + TS strict + Apache ECharts via `echarts/core` modular imports)
1. Overview: net worth card, day P&L, simple return, XIRR, allocation donuts
   (geography/platform/sector/asset-class), value-over-time area chart, stale badges.
2. Holdings table (India / US tabs): sortable + searchable TanStack Table from common
   schema; base-currency values; density-aware rows.
3. Value-over-time: ECharts area chart from `history.json` (dataZoom + range pills).
4. Returns: per-holding return bars (cost-bearing only), trend, XIRR cards, filters.
5. Alerts panel: severity-colored fired-rules log; empty state.
6. Agent chat: input → HTTP POST to the bridge (`/api/ask`) → render answer + tool-call
   chips + honest offline state. "Refresh now" → `POST /api/refresh` → real pipeline CLI
   (snapshot --all --force + export_json.py) → re-fetch static JSON.

## M8.5 revamp (design-driven)
- Design artifacts live in `docs/design/` (audit, directions, selected, spec/).
- The spec package (`docs/design/spec/spec.md` + `tokens.json` + motion + a11y) is the
  authoritative implementation brief; the `ui-designer` agent reviews design fidelity.
- The dashboard-builder implements from the spec; contract.ts stays untouched.

## Type conventions
- `src/types/contract.ts` mirrors the JSON with `readonly` fields for data types.
- `unknown`-guarded parsers, no `any` leaks. Strict TS, `noUncheckedIndexedAccess`.

## Local dev
- Vite dev server proxies `/api/*` → the agent + pipeline services. Dashboard must
  render from the fixture exports in `dashboard/public/data/` with zero network on offline dev.

## Tests / build
- `npm run build` (tsc) and `npm run lint` pass.
- Manual QA: each screen renders with representative fixture data; empty states
  handled (no holdings, no alerts, no history).