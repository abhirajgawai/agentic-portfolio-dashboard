# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal, learning-first project that consolidates holdings across brokers (Zerodha,
Groww, Sharekhan, Moomoo, plus manual real-estate entries) into one dashboard, with an
agentic Q&A layer on top. `PLAN.md` is the source of truth for design decisions and
research trails — read it before making architectural changes. `README.md` has the
Quick Start / command reference (partially stale on milestone status — trust the code
over the README's milestone table).

There is also an `AGENTS.md` (OpenCode-specific: orchestrator/subagent topology under
`.opencode/agent/`, skills under `.opencode/skill/`). Its **guardrails section is
tool-agnostic and binding regardless of which agent runs**; the multi-agent
orchestration topology itself only applies when working via OpenCode.

## Knowledge graph (`graphify-out/`)

A pre-built graphify knowledge graph of this repo lives in `graphify-out/graph.json`
(2500+ nodes, code + docs, with a `GRAPH_REPORT.md` audit trail). Reach for it — via
`/graphify query "<question>"` — for cross-cutting or architectural questions that
would otherwise require reading many files to piece together (e.g. "why do these two
agent definitions overlap," "what's the blast radius of changing `Settings`," "how did
the Journey redesign evolve across rounds"). It is **not** consulted automatically and
is not a substitute for Grep/Glob/git on routine "find this function" or "what changed"
tasks — use those directly. After a batch of changes, `/graphify --update` refreshes it
incrementally (only changed files, not a full rebuild).

## Non-negotiable guardrails

1. **Read-only broker access.** Every broker MCP client (`src/portfolio/clients/`)
   exposes only an explicit allowlist of read tools (`get_holdings`, `get_quotes`, …).
   Order place/modify/cancel tools are never referenced anywhere in the codebase. Our
   own FastMCP wrappers (`moomoo_mcp/`, `portfolio_data_mcp/`) never register write tools.
2. **No automated broker login.** Zerodha's daily browser 2FA is manual by design
   (regulatory requirement) — never build Selenium/TOTP auto-login for it. Detect
   session expiry and notify (Telegram) instead of failing silently. This does NOT
   apply to the CAMS/KFintech CAS mailback form (`cams_cas_request.py`) — that's a
   public, no-login form automated via Playwright; masking its headless-Chromium
   fingerprint (see the comment in `_submit_via_playwright`) is fine, automating a
   broker login is not.
3. **Secrets never in git.** Tokens/passwords live only in gitignored `data/tokens.json`
   and `.env`. A logging redaction filter (`src/portfolio/logging.py`) scrubs secrets
   from every log line. Before any commit: `git status` and confirm nothing under
   `data/` (db, tokens, logs, cas/, properties/), `dashboard/public/data/` (generated
   exports), or an authenticated `samples/*_authed.json` is staged.
4. **Determinism boundary.** The pipeline (snapshot → normalize → persist → export) and
   dashboard rendering are deterministic — identical input produces identical output.
   The LLM only enters through `/api/ask` → the M7 agent client (`src/portfolio/agent/`)
   and the dashboard chat drawer; it never touches the money math.
5. **Inspect before normalize.** When adding/changing a broker integration, connect to
   its MCP server, `list_tools()`, and dump raw output to `samples/` before writing or
   editing a normalizer (`src/portfolio/normalize/`). Pin samples for regression.

## Commands

### Python pipeline (`uv`-managed)

```sh
uv sync                                    # install deps into project-local .venv
uv run portfolio db migrate                # apply pending SQL migrations
uv run portfolio serve --platform zerodha  # session daemon (manual browser 2FA)
uv run portfolio snapshot --platform <zerodha|moomoo|all> [--eod]
uv run portfolio trades [--platform ...]   # daily trade + funds capture (XIRR input)
uv run portfolio cas import <file.pdf>     # parse a CAS statement -> holdings + ledger
uv run portfolio cas request [--force]     # CAMS+KFintech mailback (Groww folio MFs)
uv run portfolio cas auto [--force]        # full unattended loop: request+fetch+import
uv run portfolio nav refresh               # AMFI NAVAll.txt -> MF/ETF prices (keyless)
uv run python -m portfolio.bridge          # FastAPI bridge for the dashboard (:8001)

uv run ruff check .                        # lint (E, F, I, UP, B, SIM; line-length ignored)
uv run pytest                              # full suite
uv run pytest tests/test_cas_import.py     # single file
uv run pytest tests/test_series.py -k some_case   # single test
```

`--eod` matters: `db/persist.py` only writes `position_snapshot` (the daily ledger
`history.json`/Account Roads is derived from) when `is_eod=True`. A snapshot without
`--eod` refreshes only the live `position` table. The bridge's on-demand
`/api/snapshot/{platform}` endpoint always passes `--eod` for this reason — don't drop it.

### Dashboard (`dashboard/`, npm)

```sh
npm run dev              # vite dev server only
npm run dev:stack        # opencode serve + bridge + vite, concurrently (full local stack)
npm run build             # tsc -b && vite build
npm run typecheck         # tsc -b --noEmit
npm run lint               # oxlint
npm run check:contract     # validates exported JSON against types/contract.ts (Zod)
npm run check:daypnl       # day-P&L specific contract check
npx playwright test        # e2e (dashboard/e2e/*.spec.ts)
```

Windows Task Scheduler wrappers live in `scripts/scheduler/` (`register_tasks.ps1`,
`unregister_tasks.ps1`, `list_tasks.ps1`) — the pipeline's cron equivalent, since this
runs on a personal laptop, not a server. Zerodha/Moomoo live snapshots were deliberately
made **on-demand only** (no scheduled trigger) — the laptop isn't always on when
markets are, so fixed-time triggers were failing silently; see `register_tasks.ps1`'s
header comment for the full reasoning before re-adding a scheduled snapshot task.

## Architecture

```
[browser 2FA login] -> session daemon (serve) -> read-only RPC on 127.0.0.1:8787
                             |
Task Scheduler ----> snapshot -+-> MCP client (allowlisted tools) -> broker
  (or on-demand)              +-> normalize -> SQLite (state + history) -> JSON export
                                                     |
                                          dashboard/public/data/*.json
                                                     |
                                    React dashboard (reads JSON; bridge only for mutations)
```

**Three brokers, three integration styles** (this contrast is the point of the project):
- **Zerodha** (IN) — hosted MCP `https://mcp.kite.trade/mcp`. Access tokens expire ~6AM
  daily (regulatory), so `serve.py` runs a long-lived daemon holding one authenticated
  connection per trading day, served to `snapshot` runs over loopback RPC — scheduled/
  on-demand runs never re-authenticate themselves.
- **Groww** (IN, stocks + MFs) — no usable API (the paid Trade API is equities-only, no
  MFs — removed, see `PLAN.md` §2c). Comes from the free, SEBI-mandated **CAS**
  (Consolidated Account Statement), either uploaded manually
  (`portfolio cas import`, MIT `casparser` library) or via the automated
  CAMS+KFintech mailback loop (`cams_cas_request.py` Playwright form-fill +
  `cams_email_fetch.py` Gmail API pickup + `cas_import.py`, chained by
  `portfolio cas auto`). MF/ETF prices refresh daily from AMFI's keyless
  `NAVAll.txt` feed (`mf_nav.py`); CAS equities have no AMFI NAV and keep the
  statement price until the next import.
- **Sharekhan** (IN, equities) — same CAS import path as Groww demat holdings; no
  automated per-broker integration. Value-only, no cost basis.
- **Moomoo** (US) — the hosted MCP only grants OAuth clients `quote:read` (spike-tested
  dead end, see `PLAN.md` §2b), so holdings come from the local **OpenD** desktop
  gateway + official `moomoo-api` SDK, wrapped in a read-only FastMCP server
  (`moomoo_mcp/`).
- **Manual entries** (Groww/Sharekhan equities lump-sum, real estate) — hand-entered via
  the dashboard (`manual_holdings.py`, `property_import.py`); no automated refresh by
  design, since neither broker exposes a per-share feed.

### Database (SQLite, `data/portfolio.db`, gitignored)

Two kinds of tables by design — read `src/portfolio/db/persist.py`'s module docstring
before changing write paths:
- **State** (`account`, `instrument`, `position`) — upserted in place, never grows.
  `position` carries full-fidelity day P&L detail (`day_change_ccy/pct`, `pnl_ccy/pct`,
  realized/unrealized, `raw_json` — the broker's raw payload, no field ever lost).
- **History** (`position_snapshot`, `price_history`, `portfolio_value`,
  `account_funds`) — written **only on `--eod` runs**. `history.json`'s per-platform
  series (dashboard's Account Roads / Journey chart) is derived from
  `position_snapshot` at export time (`src/portfolio/series.py`), not from `position`.
- **Audit**: `runs` (every pipeline attempt: status, row counts, `is_eod`,
  `snapshot_date`) and `fx_rate` (one rate per run, INR base).

Migrations are sequential SQL files in `src/portfolio/db/migrations/`, applied by
`portfolio db migrate` (idempotent, safe to re-run). `db/reset.py` exists for a full
destructive reset — never call it without explicit user confirmation.

### Bridge (`src/portfolio/bridge.py`) — the only thing the dashboard talks to for mutations

A thin FastAPI seam (loopback-only, `127.0.0.1:8001` by default — `PORTFOLIO_BRIDGE_PORT`
overrides; :8000 belongs to Cardora, another local project). It **never touches broker MCPs or
the DB directly** — every mutating endpoint shells out to the real `portfolio` CLI (the
same commands you'd run by hand / the same path Task Scheduler uses) then re-runs
`scripts/export_json.py`, so there is exactly one write path regardless of trigger
source. Read the module docstring at the top of `bridge.py` for the full endpoint list
before adding a new one — keep new endpoints consistent with that shell-out pattern.

**The bridge process does not hot-reload.** After editing `bridge.py`, the running
`python -m portfolio.bridge` process is still serving the old code until restarted —
this has caused a real bug once (a fix that type-checked and looked correct kept
failing against the live server because the server was stale). If you edit `bridge.py`
and need to verify the change against a running dev stack, restart that process.

### Dashboard contract (`dashboard/src/types/contract.ts`)

Zod schemas mirroring the exact JSON shapes `scripts/export_json.py` writes to
`dashboard/public/data/` (`latest.json`, `history.json`, `alerts.json`, `xirr.json`,
`performance.json`, `goals.json`). This file is used both at build/dev time
(`npm run check:contract` machine-checks the actual exported files) and at runtime
(`src/lib/data.ts` parses fetched JSON through it). Changing an export shape in Python
means updating this file in the same change, or `check:contract` will catch the drift.

`latest.json.platforms[name].stale` is a pre-computed per-platform freshness flag
(2-day threshold for live brokers, 35-day for CAS-cadence platforms — see
`PLATFORM_STALE_DAYS` in `export_json.py`) derived from `MAX(position.updated_at)`
**across all of that platform's holdings**, including any manual lump-sum entry — so it
can mask staleness in one sub-source if another was touched recently. The dashboard's
`StalenessBanner` (`dashboard/src/components/journey/StalenessBanner.tsx`) computes
finer-grained per-holding freshness itself for that reason rather than trusting this
field for every bucket — read its module docstring before changing staleness logic.

### Dashboard structure (`dashboard/src/`)

- `components/journey/` — the default landing workspace (net worth headline, chart,
  today panel, account roads, goals/milestones, staleness banner, live job status row).
- `components/{portfolio,overview,holdings,segments,allocation,alerts,performance}/` —
  the other workspaces, switched via in-memory state (`lib/workspaces.ts`;
  `useWorkspace` hook) — **not URL routing**. There is no way to deep-link to a tab from
  outside the app currently.
- `components/cas/`, `components/holdings/{GrowwSharekhanDataScreen,ManualEquitiesScreen}` —
  the Groww/Sharekhan data-entry surface (CAS upload/request/auto-import + manual
  equity totals).
- `lib/data.ts` — all `fetch`/React Query hooks; the single place that talks to the
  bridge and to the static `public/data/*.json` exports.
- `lib/privacy.tsx` — the mask-all-values toggle (`usePrivacy`), respected throughout
  by convention (`masked ? MASK_TEXT : format...(value)`); keep new money displays
  consistent with this pattern.

### UI/design task process

When working on UI/design tasks in `dashboard/`, follow this process:

1. Before writing any UI code, state a specific visual reference you're aiming for
   (e.g. "Linear's settings page", "Vercel dashboard", "Stripe docs", "Notion's clean
   minimal style") rather than building from a generic template. If not given one,
   pick the closest fit and say what was chosen.
2. Use Tailwind CSS + shadcn/ui components as the default building blocks — the
   `shadcn` MCP server (`.mcp.json`) is available to browse/add registry components.
   Do not hand-roll custom CSS for things a shadcn component already solves (buttons,
   modals, dropdowns, forms, cards, tables).
3. Apply a consistent design system:
   - One type scale, used consistently (don't mix font sizes ad hoc)
   - 8px spacing grid (4/8/12/16/24/32/48/64)
   - Limit the palette to 1 primary color, 1-2 neutrals, and semantic colors
     (success/error/warning) — no arbitrary hex values
   - Consistent border-radius and shadow tokens across all components
4. After building or editing any UI, take a screenshot using the browser MCP and
   visually review it against the stated reference before calling the task done. Call
   out specific issues (alignment, spacing, contrast, hierarchy, crowding) and fix
   them — don't just confirm it renders without errors.
5. Favor whitespace and restraint over decoration. When unsure, remove an element
   rather than add one.
6. Never ship a first draft as final — always do at least one visual review-and-fix
   pass using the screenshot from step 4.

## Working conventions this repo has established

- **Tests are added deliberately, not by default.** Per `AGENTS.md`: write a test when
  it guards something genuinely fragile (an integration boundary, a pinned sample's
  shape, a UNIQUE-key dedupe invariant, a bug actually hit) — not for every new
  function. Prefer running the real CLI/pipeline against live/fixture data as the
  primary check.
- **Comments explain WHY, and this codebase leans on that heavily** — many modules carry
  dated, specific rationale comments (e.g. "discovered live 2026-08-25...",
  "confirmed live 2026-08-24..."). Match that style for non-obvious decisions; don't
  strip existing ones during refactors.
- Before committing, verify `.gitignore` covers any new data-producing path — add to it
  *before* staging, not after.
