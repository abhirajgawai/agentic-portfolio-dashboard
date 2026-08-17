# M8 Portfolio Dashboard

Read-only portfolio viewer + Q&A chat for the agentic-portfolio-dashboard
pipeline. Renders the four JSON exports (`public/data/`) that
`scripts/export_json.py` produces — it never calls a broker MCP or the SQLite
DB directly. The only dynamic surface is the chat + refresh bridge.

**Stack:** Vite 8 + React 19 + TypeScript (strict) · Tailwind v4 + shadcn/ui
(dark) · Apache ECharts (modular `echarts/core`) · TanStack Query + Table ·
Zod v4 (the contract) · FastAPI bridge (127.0.0.1:8000).

## Layout

```
src/
  types/contract.ts   Zod schemas for the 4 JSONs — THE CONTRACT (M9 swap:
                      Supabase PostgREST views return the same shapes)
  types/bridge.ts     /api health/refresh/ask response types
  lib/data.ts         typed client + TanStack Query hooks (fetch public/data)
  lib/api.ts          bridge HTTP client (health/refresh/ask)
  lib/charts.ts       modular ECharts registration (tree-shaken)
  components/
    ui/               shadcn/ui primitives (button, card, badge, tabs, …)
    charts/           EChart wrapper + shared option builders (dark theme)
    layout/           app shell, status bar, loading/error/empty states
    overview/         header cards, 4 allocation donuts, value-over-time chart
    holdings/         TanStack Table (India view w/ platform filter, US view)
    returns/          per-holding return bars, trend, XIRR cards
    alerts/           fired-alert log with severity colors
    chat/             right-panel chat drawer → /api/ask → M7 agent
```

## Run it

Order matters — the dashboard is a static viewer plus a thin bridge:

1. **Bridge** (terminal 1, repo root):
   ```powershell
   uv run uvicorn portfolio.bridge:app --host 127.0.0.1 --port 8000
   ```
   (or `uv run python -m portfolio.bridge`). Loopback only — the bridge is the
   local dev seam; M9 replaces it with Supabase.

2. **Dashboard** (terminal 2, `dashboard/`):
   ```powershell
   npm install      # first time
   npm run dev      # http://localhost:5173
   ```
   Vite proxies `/api/*` → `127.0.0.1:8000`.

3. **Chat needs the agent** (optional, terminal 3, repo root):
   ```powershell
   opencode serve   # http://127.0.0.1:4096 (default)
   ```
   Without it, the chat drawer shows "agent offline" and `/api/ask` returns a
   clean 503. The pipeline's Zerodha daemon (2FA) may also be needed for a
   live refresh — the bridge reports per-leg results honestly.

## Flows

- **Refresh now** (header button) → `POST /api/refresh` → the bridge runs
  `python -m portfolio.cli snapshot --platform all --force` then
  `python scripts/export_json.py` → the four JSONs are regenerated → TanStack
  Query invalidates and every screen re-renders. A failed leg (e.g. moomoo/
  OpenD down) is reported inside the summary — the refresh still succeeds.
- **Chat** (right panel) → `POST /api/ask {question}` → the bridge calls the
  M7 `OpenCodeClient` (read-only portfolio-analyst agent) → the answer renders
  with tool-call chips (the allowlisted MCP tools it used). Every tool call is
  audited to `data/logs/agent_audit.jsonl` (gitignored).

## Ports

| Port | Service |
|---|---|
| 5173 | Vite dev server (dashboard) |
| 8000 | FastAPI bridge (loopback) |
| 4096 | `opencode serve` (M7 agent) |
| 8787 | Zerodha session daemon (pipeline) |
| 11111 | Moomoo OpenD gateway (pipeline) |

## Contract

`src/types/contract.ts` formalizes the four exported JSONs as Zod schemas.
Verify the REAL exported files parse against them at any time:

```powershell
npm run check:contract
```

M9 note: swapping the data source is a base-URL change in `src/lib/data.ts`
(`VITE_DATA_BASE_URL`) — no component changes.

## Checks

```powershell
npm run build       # tsc -b + vite build
npm run typecheck   # tsc -b --noEmit
npm run lint        # oxlint
npm run check:contract
uv run ruff check . # repo-wide (from the repo root)
```

## Manual QA checklist

- [ ] Overview shows the 4 header cards with real totals (₹6x L, day P&L,
      simple return with cost coverage, XIRR "no captured trades yet").
- [ ] All 4 donuts render with legends; sectors/platforms sum to ~100%.
- [ ] Trend chart plots the history dates; tooltips format as ₹.
- [ ] Staleness badge appears next to a stale platform (e.g. moomoo when its
      leg has not run in 2+ days).
- [ ] India tab: 62 rows across zerodha/groww/sharekhan; platform filter
      narrows; search works; sorting works on every column; return % shows —
      for costless rows.
- [ ] US tab: 6 moomoo rows shown in SGD (valueDisplay), platform column
      hidden.
- [ ] Returns tab: bar chart of cost-bearing holdings, trend line, XIRR cards
      (empty state "no captured trades yet").
- [ ] Alerts tab: severity-colored list (1 warn = KPITTECH deep loss) or
      clean empty state.
- [ ] Refresh now: runs the live pipeline, regenerates JSONs, updates the "as
      of" label and all numbers without a page reload.
- [ ] Chat: question → answer + tool chips; close/reopen the drawer; ask with
      opencode serve stopped → "agent offline" note, no crash.
- [ ] Narrow window (<1024px): tables scroll horizontally, chat drawer
      overlays full-width.