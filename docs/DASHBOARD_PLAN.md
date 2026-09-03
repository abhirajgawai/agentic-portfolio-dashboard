# M8 Dashboard — Technology & Implementation Plan (for approval)

Status: **PLAN — awaiting user approval. No code written yet.**
Author: orchestrator, based on a 2026 landscape research pass (sources in the
stack table). Supersedes the earlier "Vite + recharts" sketch in PLAN.md — same
contract, upgraded stack.

---

## 1. Goal & principles

A **modern, finance-grade dashboard** (dark theme, polished, dense) that is:

1. **A read-only viewer** of the pipeline's output — never calls broker MCPs.
2. **Contract-first**: it consumes the four JSON files the pipeline already exports
   (`latest.json`, `history.json`, `alerts.json`, `xirr.json`) through typed Zod
   schemas — the *same* contract survives the M9 swap to Supabase with the UI
   changing only a base-URL.
3. **Deterministic rendering** (M8 stays in the determinism boundary); the LLM enters
   only through the chat drawer → M7 agent.
4. **Backend-ready**: a thin local FastAPI bridge today (refresh + chat + health),
   replaced wholesale by Supabase/PostgREST at M9 — the Zod contract is the only seam.
5. **Future-proof**: per-holding price charts, funds/cash, XIRR trend, and an alerts
   manager are designed-for, not bolted-on.

## 2. Our data — what exists and what it enables

### Today (the four exported JSONs — already live in `dashboard/public/data/`)
| File | Shape (abridged) | Powers |
|---|---|---|
| `latest.json` | `asOf`, `baseCurrency=INR`, `fx{USDINR,SGDINR,USD_SGD}`, `platforms{*: {asOf, stale}}`, `totals{valueBase, dayPnl, byAccountCurrency}`, `allocation{byGeography, byPlatform, bySector, byAssetClass}` (%), `holdings[]` (platform, geography, ticker, name, qty, avgPrice, ltp, value, valueBase, valueDisplay, displayCurrency, returnPct, dayPnl, dayChangePct, sector, assetClass, …) | Overview cards, donuts, holdings tables, staleness badges |
| `history.json` | `dates[]`, `portfolioValueBase[]`, `byGeography{IN[],US[]}`, `byPlatform{…}` (arrays aligned to `dates[]`) | value-over-time chart |
| `alerts.json` | `generatedAt`, `alerts[{ruleId, severity, message}]` | alerts screen |
| `xirr.json` | `perAccount{<key>: {currency, xirrPct, terminalValue, flowCount}}` | returns cards |

### In SQLite today (available to the bridge now, PostgREST views at M9)
`position` (live state) · `position_snapshot` (daily ledger) · `price_history`
(EOD closes per instrument) · `trade` (cash flows) · `account_funds` (cash /
buying power) · `fx_rate` · `runs` (audit) · `alert_events` · `instrument` ·
`account`. This is what enables the *future* features below without new data
collection.

### Future features this plan designs for
- **Per-holding price-history charts** (`price_history` → multi-series lines, later
  candlesticks) — the reason the charting choice matters.
- **Funds / cash view** (`account_funds`: cash, buying power, total assets).
- **XIRR trend** over time (rolling computation on the ledger).
- **Alerts manager** (enable/disable rules — a deliberate WRITE path, only via the
  bridge/Supabase, never from the UI directly into rules.yaml).
- **Runs / ops view** (the `runs` audit trail — "is everything healthy today").
- **M9**: multi-device via Vercel; the shared Supabase spine; staleness nags.

## 3. Screens

| Screen | Now (M8) | Future |
|---|---|---|
| **Overview** | cards (total value INR, day P&L, simple return %, XIRR) · donuts (geography / platform / sector / asset class) · value-over-time area chart · staleness badges · alerts chip | funds/cash cards |
| **India view** | holdings table (INR) with platform filter (Zerodha/Groww/Sharekhan) | — |
| **US view** | moomoo holdings table (display currency via `valueDisplay`) | — |
| **Returns** | per-holding return bars (cost-bearing only) · trend line · XIRR cards | XIRR trend chart |
| **Alerts** | fired-log with severity colors, empty state | rule toggles (write via bridge) |
| **Chat drawer** | right panel → `/api/ask` → M7 agent; tool-call chips; "agent offline" state | streaming answers |
| (future) | — | per-holding price pane (lightweight-charts), runs/ops view |

Every screen renders offline from the four JSONs (zero network); empty states
everywhere; "as of" + stale badge from `latest.json.asOf/platforms`.

## 4. Architecture

```
TODAY (M8)                                    M9 (deploy)
┌──────────────────────┐                     ┌──────────────────────┐
│ React SPA (Vite)     │                     │ React SPA (Vercel)   │
│ 5173 · /api proxy    │                     │ same components      │
└─────────┬────────────┘                     └─────────┬────────────┘
          │ /api/* (Vite dev proxy)                    │ HTTPS
          ▼                                            ▼
┌──────────────────────┐                     ┌──────────────────────┐
│ FastAPI bridge       │                     │ Supabase             │
│ 127.0.0.1:8001       │                     │ · PostgREST VIEWS    │
│ · GET  /api/health   │                     │   (v_latest, ... —   │
│ · POST /api/refresh  │  ──contract──►      │   SAME JSON shape)   │
│   (pipeline snapshot │                     │ · RLS = read-only    │
│    + re-export)      │                     │ · Edge Function:     │
│ · POST /api/ask →    │                     │   refresh trigger    │
│   M7 agent client    │                     │ · GH Actions: keyless│
│                      │                     │   legs → Postgres    │
└──────────────────────┘                     └──────────────────────┘
        ▲                                                       
        │ static files today / PostgREST at M9 — the UI only sees
        ▼ THE ZOD CONTRACT (unchanged shapes)
```

**The seam:** the four JSON shapes are formalized as **Zod schemas** (one source of
truth, TS-inferred types). A single typed client reads them — from static files
today, from PostgREST views at M9. The swap is a base-URL change + a client
re-point; **no component changes**. The same Zod schemas validate the static files
now, so the contract is machine-checked from day one.

## 5. Recommended stack (2026 research-backed)

| Slot | Pick | Why | Alternatives |
|---|---|---|---|
| **Framework** | **Vite 8 + React 19 SPA** | Zero SEO/SSR needs; Python-first monorepo (the pipeline IS the backend logic); instant dev, static deploy to Vercel; no Next complexity/security-patch tax for features we won't use | Next.js 16 (if SSR/marketing later); SvelteKit (thinner finance-chart ecosystem) |
| **Charting** | **Apache ECharts** (`echarts-for-react`) | Only lib covering ALL our needs: donuts, area/line, multi-series, **dual-axis, dataZoom/pan, candlesticks**, dark themes — 67k★, Apache-governed, actively maintained. Finance-grade. | recharts (fine for simple, hits walls on zoom/candles); TanStack Charts (young) |
| **Price pane (future)** | **TradingView lightweight-charts** | Domain-native candlesticks/pan-zoom later; ECharts covers everything until then | — |
| **UI kit** | **shadcn/ui v4 + Tailwind v4** | The modern Linear/Vercel dark aesthetic requested; copy-paste = we own the code, infinitely themeable, no upgrade lock-in; ships chart + table integrations | Mantine 9 (batteries-included, heavier look); MUI X (best grid, but Material look) |
| **Data layer** | **TanStack Query + TanStack Table + Zod v4** | The 2026 standard: Query = server state, Table = sortable/filterable grids, Zod = the contract seam | tRPC (needs TS backend — we're Python) |
| **Backend (now)** | **FastAPI bridge** (127.0.0.1) | Can call the Python pipeline + the M7 agent client **in-process** — no proxy hops | Next.js API routes (would proxy into Python: pure cost) |
| **Backend (M9)** | **Supabase** (PostgREST views + RLS + Edge Function) | RLS maps to guardrail #1 (SELECT-only boundary free); views return the identical JSON contract | — |

**Known tradeoffs (accepted):** ECharts is heavier than recharts — mitigated with
`echarts/core` modular imports (tree-shaken bundle); its API is option-object-based
(not JSX) — a different mental model, fine for a dashboard. lightweight-charts
carries an attribution notice (Apache-2.0 requirement) — only when the price pane
is built.

## 6. Implementation phases (M8)

| # | Phase | Done-when |
|---|---|---|
| 1 | Scaffold: Vite + React + TS strict + Tailwind v4 + shadcn/ui + dark theme shell | `npm run build` green; themed shell with tabs renders |
| 2 | Contract layer: Zod schemas for the 4 JSONs + typed client + TanStack Query hooks | schemas parse the REAL exported files; loaders typecheck |
| 3 | Overview screen (cards, 4 donuts via ECharts, trend chart, staleness badges, alerts chip) | renders today's real data |
| 4 | India + US holdings tables (TanStack Table, platform filter, empty states) | real rows, sorting, filtering |
| 5 | Returns screen (per-holding bars, trend, XIRR cards) | real return/XIRR data |
| 6 | Alerts screen (severity colors, empty state) | real alert events |
| 7 | FastAPI bridge (health / refresh / ask) + chat drawer + Vite proxy | chat answers end-to-end; refresh regenerates JSONs and updates UI |
| 8 | Polish: loading/error/offline states, README, `npm run build` + lint + manual QA | checklist signed off |
| (future) | Price-history pane, funds view, alerts manager, runs view | M8.5+ or M9-adjacent |

## 7. Decisions for approval

1. **Framework: Vite + React SPA** (recommended) vs Next.js 16 vs SvelteKit.
2. **Charting: Apache ECharts** (recommended) vs keep recharts vs TanStack Charts.
3. **UI kit: shadcn/ui + Tailwind v4** (recommended) vs Mantine 9 vs MUI X.
4. **Data layer: TanStack Query + Table + Zod v4** (recommended — no real alternative
   given the Python backend).
5. **Backend: FastAPI bridge now → Supabase at M9** (recommended — contract-first
   seam keeps the UI untouched).
6. Scope: 6 screens as listed; future features deferred but designed-for.

Approve as-is → I delegate implementation to the `dashboard-builder` worker in
phases (gate at each). Want changes → tell me which slot and we adjust the plan.
