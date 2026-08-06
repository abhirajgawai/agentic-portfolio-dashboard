# Agentic Portfolio Dashboard — Build Plan

Personal-use, manually-built project. Primary goal is **learning**: MCP client integration
across multiple real providers, building a variable-length agentic tool-calling loop,
scheduling under real-world constraints (market hours, holidays, token expiry), separating
deterministic pipelines from non-deterministic agent reasoning, and deploying a
scheduled + on-demand hybrid system.

Work phase by phase. Each phase must be working and verified before starting the next.

---

## 1. Locked decisions

| Decision | Choice |
|---|---|
| Pipeline / agent language | Python (uv project, ruff, pytest) |
| Storage | SQLite first → migrate to Supabase in Phase 7 |
| Agent runtime (Phase 5) | opencode server API (`opencode serve`, HTTP + SSE) |
| Alert delivery | Telegram bot |
| Base currency (consolidated view) | INR (configurable) |
| Dashboard | Vite + React + TypeScript + recharts |
| Local scheduler | Windows Task Scheduler (Phases 1–6) |
| Repo | `E:\agentic-portfolio-dashboard` (private) |

### Brokers
- **Zerodha** (IN) — hosted MCP `https://mcp.kite.trade/mcp`
- **Groww** (IN) — official REST Trade API (`groww.in/trade-api`, ₹499/mo, Python SDK
  `growwapi`); **no official MCP exists** — we wrap it ourselves (FastMCP)
- **Moomoo** (US, SG account) — hosted MCP `https://mcp.moomoo.com/mcp` (OAuth-protected,
  verified live: returns 401 unauthenticated); fallback: OpenD gateway + official Python SDK

---

## 2. Research findings — Zerodha token refresh (verified 2026-08)

**Question raised:** do we really need the daily manual token-refresh step for Zerodha?

**Answer: yes, daily re-authentication is still mandatory — but the work is smaller than
originally planned.**

Sources (current official docs, fetched 2026-08-06):
- Kite Connect v3 docs, `access_token` attribute: *"Unless invalidated using the API, or by
  a master-logout from the Kite Web terminal, it'll expire at **6 AM on the next day
  (regulatory requirement)**."* — https://kite.trade/docs/connect/v3/user/
- `refresh_token` exists in the response but: *"only available to certain approved
  platforms"* (empty for normal apps). So no automated renewal for us.
- Changelog (https://kite.trade/docs/connect/v3/changelog/) shows **no change** to token
  lifetime; latest entries are Alerts API (2025-06-12), MTF orders (2025-01-17).

**What the hosted MCP changes:**
- The MCP server (`mcp.kite.trade`, api_key `kitemcp`) runs the whole token exchange itself.
  Its `login` tool generates the authorization link; after browser login + 2FA, the server
  keeps the session keyed by a `session_id`. We do **not** need to build a
  redirect-capture + request_token-exchange script (that's only needed if we self-host
  kite-mcp-server with our own Kite Connect API key or use the raw REST API).
- The daily step is therefore: **complete one browser login (2FA) per day**, initiated via
  the MCP `login` tool. Nothing can legally be scripted around this.
- When the session is expired, MCP tools respond with "please log in first" — the pipeline
  must detect this and notify (Telegram) rather than fail silently.

**CORRECTION (verified 2026-08-06, against live server v0.3.2 + kite-mcp-server source):**
the hosted server does **NOT** persist a logged-in session across MCP connections, so
"one login per day" cannot be reused by separate scheduled runs as originally assumed.
Evidence:
- `kc/session.go`: `SessionRegistry.Generate()` = `kitemcp-` + fresh uuid per connection;
  Kite access token is stored in-memory keyed by that session id, 12h lifetime
  (`DefaultSessionDuration`).
- `app/app.go`: `createStreamableHTTPServer` wires that registry as mcp-go's
  `SessionIdManager`; mcp-go v0.31.0 `server/streamable_http.go` explicitly does not
  implement **Stream Resumability** — every `initialize` mints a new session id, and
  sending `Mcp-Session-Id` on a fresh connection returns a *new* id (tested live).
- Closing the connection (`DELETE`, i.e. our client's `terminate_on_close`) **invalidates**
  the Kite token (cleanup hook calls `InvalidateAccessToken`).

**Design consequence (implemented in M1):** a **persistent session daemon**
(`portfolio serve --platform zerodha`) holds ONE authenticated connection for the trading
day on loopback (127.0.0.1:8787). It performs the single daily manual browser login, keeps
the connection alive with heartbeats, and serves read-only RPC (`/rpc`) to snapshot runs
(`portfolio snapshot --platform zerodha`). Session loss mid-day → Telegram warning. This
keeps MCP-first learning, the daily manual 2FA, and enables unattended scheduled runs.

**Other useful findings:**
- **The hosted server still lists order tools** (`place_order`, `modify_order`,
  `cancel_order`, GTT write tools) in its live `tools/list` (22 tools, verified 2026-08-06)
  despite the README claiming `EXCLUDED_TOOLS` server-side — so the **client-side
  allowlist is the real boundary** (guardrail #1) and the Q&A agent's opencode `tools`
  config must disable them too. The self-hosted server supports `EXCLUDED_TOOLS` for
  read-only instances. (https://github.com/zerodha/kite-mcp-server)
- Kite MCP tool inventory (22 tools) includes `get_holdings`, `get_positions`,
  `get_mf_holdings`, `get_orders`, `get_trades`, `get_order_history`, `get_historical_data`,
  `get_quotes`, `get_margins`, `get_profile`.
- **Order/trade history is same-day only** (confirmed by Zerodha staff on the announcement
  thread). For Phase 3 XIRR we must **capture trades daily going forward**; no bulk
  backfill. Start capturing early.
- Kite Connect now has a native **Alerts API** (added 2025-06-12) — noted as an option for
  Phase 4, though our cross-broker rule engine stays the primary path.

## 2b. Research findings — other platforms & agent guardrails (verified 2026-08-06)

**Groww — no official MCP (spec corrected).** Groww's official product is the **REST Trade
API** (https://groww.in/trade-api, ₹499/mo + taxes): Portfolio APIs (Get Holdings, Get
Positions), Orders, Data (LTP/Quote/OHLC), Smart Orders (OCO/GTT), historical candles
(up to 3 months). Official **Python SDK `growwapi`** (auth via a single
`API_AUTH_TOKEN`). Only community MCP wrappers exist (e.g. `karthik1729/groww-mcp`) —
so **Groww gets a custom FastMCP wrapper**. Token
lifetime (spec assumes daily ~6 AM) must be verified against the docs after getting the
key — the docs are a JS app, not scrapable anonymously.

**Moomoo — hosted MCP is market-data-only; OpenD gateway is the holdings path (spike
conclusion, verified live 2026-08-06).** The hosted MCP `https://mcp.moomoo.com/mcp` is a
standard MCP-OAuth server: RFC 8414 discovery at
`/.well-known/oauth-authorization-server` (authorize + token + dynamic-registration
endpoints on `webapi.moomoo.com`), RFC 9728 protected-resource metadata at
`/.well-known/oauth-protected-resource`, scopes `quote:read quote:write trade:read
trade:write accid:*`, PKCE S256, `authorization_code` + `refresh_token` grants, and
`/mcp` returns 401 with `WWW-Authenticate: Bearer resource_metadata=...` unauthenticated.
The `mcp` SDK's `OAuthClientProvider` completes the whole flow automatically (discovery →
dynamic client registration → PKCE → token storage → auto-refresh).

**But the AS only grants `quote:read` to dynamically-registered clients.** Three separate
consents, each explicitly requesting `quote:read trade:read accid:*`, each returned a
token with scope `quote:read` only. With that token: `initialize`, `tools/list`, and all
`quote_*` market-data tools work (88-tool inventory captured to `samples/moomoo/_tools.json`);
the account tools (`account_authorized_trd_accs`, `account_positions`, `account_funds`)
401 with `{"error":"invalid_token","error_description":"access token expired or invalid,
please re-authorize"}`. Trade/account scopes are evidently reserved for approved OpenAPI
applications, not anonymous dynamic registration.

**Design consequence (adopted for M2):** holdings come from the **OpenD gateway** (local
desktop app, Windows supported, holds the Moomoo login like the Zerodha daemon holds the
Kite session) via the official `moomoo-api` SDK (v10.9, `pip install moomoo-api`), wrapped
in our own **read-only FastMCP server** (`moomoo_mcp/server.py`, same pattern as the Groww
wrapper). Tools: `get_accounts`, `get_positions`, `get_funds` — order tools are never
registered. The `unlock_trade` step reads the trading password from gitignored
`data/tokens.json` at startup and never exposes it as a tool argument. The hosted-MCP
OAuth client (`portfolio/tokens/moomoo_oauth.py`) remains as a documented integration
(and a market-data source for M5/M6) but is not the holdings path. Community reference:
`Litash/moomoo-api-mcp` (Python, actively maintained).

**opencode guardrail mechanism (corrected):** opencode's `permission` config covers
built-in tools only (read/edit/bash/webfetch/…). **MCP tools are controlled via the
`tools` config** with glob patterns (tools are registered as `<server>_<tool>`), plus
per-agent `tools` overrides:
```jsonc
{
  "tools": {
    "kite_place_order": false,      // belt...
    "kite_modify_order": false,
    "kite_cancel_order": false,
    "kite_*gtt*": false
  },
  "agent": {
    "portfolio-analyst": { "tools": { "kite_get_*": true, "portfolio_*": true } }
  }
}
```
Also useful: opencode **auto-handles OAuth for remote MCP servers** (dynamic client
registration, tokens stored in `~/.local/share/opencode/mcp-auth.json`,
`opencode mcp auth <server>`) — this covers Moomoo MCP auth on the agent side for free.
The **pipeline side** (Python) still needs its own OAuth token handling for Moomoo.
Sources: https://opencode.ai/docs/permissions/ , https://opencode.ai/docs/mcp-servers/

---

## 3. Architecture

```
[daily browser login: Zerodha/Groww] ──> token/session store (gitignored)
                                                        │
Windows Task Scheduler ──> snapshot runner ──> MCP clients ──> Zerodha MCP (hosted)
                                          │                ──> Groww custom MCP (FastMCP → REST Trade API)
                                          │                ──> Moomoo MCP (hosted, OAuth, auto-refresh)
                                          ├─> normalizers ──> common schema ──> SQLite
                                          ├─> FX fetch (one rate per run, persisted)
                                          ├─> holiday/market-hours gate (static calendars)
                                          ├─> daily trade capture (for XIRR)
                                          └─> alert evaluator ──> Telegram

SQLite ──> JSON export ──> React dashboard (static charts)
                        └─> chat panel ──> opencode serve (agent)
Agent tools: portfolio-data MCP (read-only SQL views) + broker MCPs (allowlisted read-only tools)
```

### Key design resolutions
1. **opencode as agent runtime:** opencode's server API is session/message-based, not a raw
   completions endpoint — it *is* the agent runtime. We hand-roll the orchestration around
   it: session lifecycle, turn/time budget enforcement (`POST /session/:id/abort`), and
   tool-allowlist audit. (Optional standalone exercise: a raw hand-rolled loop against a
   provider API key, if available — does not block the project.)
2. **Scheduling vs manual tokens:** manual-token legs (Zerodha/Groww) run on the
   local machine via Task Scheduler, where the tokens live. SQLite has a single writer, so
   all legs run locally in Phases 1–6. After the Supabase migration (Phase 7), the
   fully-automatable Moomoo leg + alert evaluation move to GitHub Actions cron.

---

## 4. Repo layout

```
agentic-portfolio-dashboard/
├─ PLAN.md                      # this file
├─ pyproject.toml               # uv-managed
├─ .env.example                 # committed; real .env gitignored
├─ .gitignore                   # data/*.db, data/tokens.json, .env, samples with tokens
├─ src/portfolio/
│  ├─ config.py                 # env loading, platform registry
│  ├─ db/                       # schema.sql, migrate.py
│  ├─ tokens/                   # store.py, session_check.py,
│  │                            # zerodha_login.py, groww_login.py, moomoo_oauth.py
│  ├─ clients/                  # one MCP client module per broker;
│  │                            # each holds its read-only tool ALLOWLIST
│  ├─ normalize/                # schema.py + one normalizer per broker
│  ├─ fx.py                     # one rate per run, source+rate persisted
│  ├─ calendars.py              # holiday JSON + market-window logic (zoneinfo)
│  ├─ snapshot.py               # orchestrates one run
│  ├─ trades.py                 # daily trade capture (XIRR input)
│  ├─ returns.py                # simple returns, time series, XIRR
│  ├─ alerts/                   # rules.yaml loader, evaluator, telegram.py
│  └─ agent/                    # opencode HTTP/SSE client, budget enforcement
├─ groww_mcp/                   # FastMCP stdio server wrapping Groww Trade API (read-only)
├─ portfolio_data_mcp/          # FastMCP server exposing read-only SQLite views to agent
├─ data/                        # gitignored: portfolio.db, tokens.json
│  ├─ holidays/                 # committed: nse_2026.json, nyse_2026.json (static lists)
│  └─ sectors.csv               # committed: curated ticker→sector/asset_class map
├─ samples/                     # raw MCP outputs captured BEFORE writing normalizers
├─ scripts/                     # scheduled entrypoints, export_json.py
├─ tests/                       # pytest; normalizers & XIRR against fixed fixtures
└─ dashboard/                   # Vite + React + TS + recharts (Phase 6)
```

### Common holding schema (normalization target)
```
{ platform, geography: "IN"|"US", ticker, name, quantity, avg_price,
  current_price, cost_basis, current_value, currency, sector, asset_class }
```
Snapshot rows add: `run_at (UTC)`, `snapshot_date`, `fx_rate_to_base`,
`current_value_base`, `is_eod` flag. UNIQUE on `(run_at, platform, ticker)`.

### DB tables (SQLite v1)
`snapshots`, `fx_rates`, `runs` (pipeline run log: platform, started_at, status, rows,
error), `trades` (daily capture), later: `alert_rules`, `alert_events`.
Tokens live in `data/tokens.json` (gitignored), never in the DB or snapshots.

---

## 5. Milestones

### M0 — Scaffold (~½ day)
- Init private git repo, uv project; deps: `mcp`, `httpx`, `typer`, `pytest`, `ruff`.
- DB schema v1 + migration script; logging with a secret-redaction filter.
- ✅ Done when: `portfolio db migrate` creates the schema; redaction test passes.

### M1 — Zerodha end-to-end (2–3 evenings)
1. Connect Python MCP client to `https://mcp.kite.trade/mcp` (streamable HTTP);
   `list_tools()` and dump raw outputs of `get_holdings` / `get_quotes` to `samples/`
   **before** writing any normalization code.
2. Session helper (`tokens/zerodha_login.py`): detect expired session → call MCP `login`
   tool → open the authorization URL in the browser → wait for completion → verify with
   `get_profile`. This is the daily manual step (see §2 — no token-exchange script needed).
3. Normalizer → common schema; upsert into `snapshots`; CLI: `portfolio snapshot --platform zerodha`.
4. Expired-session detection inside the snapshot run → Telegram warning
   ("Zerodha session expired — run login") instead of silent failure.
- ✅ Done when: snapshot rows match Zerodha's holdings UI; same-day re-run doesn't
  duplicate; expired session produces a notification, not a crash.

### M2 — Moomoo + consolidated view (2–3 evenings)
- **Spike (DONE, 2026-08-06):** connected to `https://mcp.moomoo.com/mcp` end-to-end —
  OAuth discovery, dynamic registration, PKCE consent, token refresh all work; **88-tool
  inventory captured** (`samples/moomoo/_tools.json`). **Conclusion:** the AS grants only
  `quote:read` to dynamic clients (3 consents, 3x `quote:read`), so the hosted MCP is
  market-data-only — account tools 401. **Holdings therefore come from the OpenD gateway
  fallback** (`moomoo_mcp/` read-only FastMCP over `moomoo-api`, §2b).
- One-time OpenD setup: install the desktop app, log in (manual), store the trade
  password via `portfolio auth --platform moomoo` (gitignored `data/tokens.json`).
- US normalizer (geography US, currency USD) — reuses the Futu PositionInfo field names
  (`code`/`qty`/`cost_price`/`nominal_price`/`market_val`), verified against a live sample.
- FX module: one INR/USD (+SGD) rate per run via open.er-api.com (keyless, deterministic),
  persisted to `fx_rates`. Process-wide cache enforces one fetch per run.
- Consolidated allocation in INR base: geography / platform / sector / asset_class each
  sum to 100% (`normalize/allocation.py`).
- ✅ Done when: `portfolio snapshot --all` reconciles with both broker UIs; consolidated
  allocation sums to 100%.

### M3 — Groww wrapper (2–3 evenings)
- Groww: **official REST Trade API + `growwapi` Python SDK — no official MCP exists**,
  so build a thin custom FastMCP wrapper exposing read-only
  tools (`get_holdings`, `get_positions`, quotes). **Verify token lifetime against the
  actual docs first** (assumed daily ~6 AM); if confirmed, same manual daily-login
  pattern as Zerodha.
- Start daily trade capture (`trades.py`) for all platforms with history access.
- ✅ Done when: 3-platform consolidated snapshot equals the manual sum of all three UIs.

### M4 — Scheduling + calendars (1–2 evenings)
- Static holiday JSONs (NSE, NYSE — published yearly lists) + weekend check.
- Market windows via `zoneinfo("Asia/Kolkata")` / `zoneinfo("America/New_York")` —
  never hardcoded IST offsets (US session shifts with DST; IST doesn't).
- Task Scheduler jobs: India legs ~09:45 IST + ~15:45 IST EOD (`is_eod`), US leg after
  close; every run gated by calendar/hours and logged to `runs`.
- ✅ Done when: one week runs unattended; holidays/weekends skipped and logged; failures
  visible in `runs`.

### M5 — Returns & XIRR (2 evenings)
- Per-holding return `(currentValue - costBasis) / costBasis`; time series from EOD
  snapshots (value grows with age — snapshots start in M1).
- XIRR from accumulated `trades` + current value as terminal cashflow; Newton/bisection
  solver (~20 lines), tested against a hand-computable fixture.
- ✅ Done when: XIRR matches the fixture; charts render from real accumulated data.

### M6 — Alerts, rule-based only (1–2 evenings)
- Declarative `rules.yaml`: daily drop > X%, target/stop cross, RSI/MA crossovers.
  RSI/MA from accumulated snapshots or broker historical candles for day-one coverage.
- Evaluate after each poll inside existing jobs; dedupe per (rule, trading day);
  Telegram delivery; `--dry-run` mode.
- **No AI judgment anywhere in this path** — explicit numeric conditions only.
- ✅ Done when: a test rule fires on historical data and notifies exactly once.

### M7 — Q&A agent (3–4 evenings)
1. `portfolio_data_mcp`: read-only tools over SQLite (`latest_snapshot`,
   `holding_history`, `allocation_summary`, …).
2. opencode project config: register the 4 MCP servers. Guardrails via the **`tools`
   config** (not `permission` — that covers built-in tools only): globally disable
   destructive MCP tools (`kite_place_order`, `kite_modify_order`, `kite_cancel_order`,
   `*_gtt*`, any order tools on the other servers), and enable only the read-only
   allowlist on the dedicated `portfolio-analyst` agent (§2b has the config shape).
   Hosted Kite MCP already excludes destructive tools server-side; our custom wrappers
   never register them at all. Moomoo OAuth is handled by opencode itself
   (`opencode mcp auth moomoo`).
3. Python client against `opencode serve`: create session → post question → stream SSE →
   final text; enforce `maxTurns`/time budget client-side via the abort endpoint; log
   every tool call for audit.
4. Eval set: 10–15 canned questions incl. multi-hop ("total semiconductor exposure across
   US + India?"); verify any non-allowlisted tool call is denied.
- ✅ Done when: eval questions answered within budget from CLI with zero non-allowlisted
  tool executions.

### M8 — Dashboard & UI design (2–3 evenings)

**How MCP data reaches the UI** — two paths, deliberately separate:
1. **Dashboard (deterministic, no LLM):** renders the latest snapshot. Each pipeline run
   ends with `scripts/export_json.py` regenerating static JSON the UI fetches. A
   **"Refresh now"** button calls a small local FastAPI bridge that triggers an on-demand
   pipeline run (MCP pulls → normalize → SQLite → re-export JSON) and returns when done —
   this is how *live* MCP portfolio data reaches the UI. Freshness = last run, always
   shown as an "as of 15:45 IST, 06 Aug" label + a staleness badge if the last EOD run
   is missing.
2. **Chat panel (agentic):** wired to the Phase 5 agent for ad-hoc questions; the agent
   can pull live MCP data on demand, but the dashboard never depends on it.

**JSON contract** (generated artifacts in `dashboard/public/data/`):
```
latest.json    → { asOf, baseCurrency, fx: {USDINR, SGDINR},
                   totals: { valueBase, dayPnl, totalReturnPct },
                   byGeography, byPlatform, bySector, byAssetClass,   // allocation sums
                   holdings: [ { platform, geography, ticker, name, qty, avgPrice, ltp,
                                 value, valueBase, dayChangePct, returnPct, sector } ] }
history.json   → { dates[], portfolioValueBase[], byGeography: {IN[], US[]},
                   perHolding: { ticker: { dates[], value[], returnPct[] } } }
alerts.json    → rules + fired events (Phase 4)
```

**Screens** (Vite + React + recharts, tab layout):
1. **Overview (consolidated):** header cards — total value (INR base), day P&L, total
   return %, XIRR (Phase 3). Donuts: geography (IN vs US), platform (3 brokers), sector
   (cross-market — this is where e.g. semiconductor exposure across US + India becomes
   visible), asset class. Line chart: portfolio value trend from EOD snapshots.
2. **India view:** everything in INR — holdings table (ticker, name, platform badge, qty,
   avg price, LTP, value, day %, return %) + allocation by sector and by stock; filter by
   platform (Zerodha/Groww).
3. **US view:** same layout in USD (Moomoo holdings).
4. **Returns:** per-holding return bar chart, portfolio trend line, XIRR/CAGR cards.
5. **Alerts:** rule list with enable toggles + fired-events log.
6. **Chat drawer:** persistent right-side panel → agent bridge.

**Post-deployment (M9):** same contract, but JSON comes from Supabase (dashboard queries
it directly or via an edge function); Refresh-now becomes a serverless function trigger.
- ✅ Done when: local dashboard shows today's snapshot across all three views; Refresh-now
  pulls live MCP data and updates the UI; chat answers end-to-end.

### M9 — Deployment (2–3 evenings)
- Migrate SQLite → Supabase (schema ports 1:1).
- Moomoo leg + alert evaluation → GitHub Actions cron (secrets in Actions env); India
  legs stay local (manual tokens) unless we opt into pushing the daily token to a Supabase
  secrets table — decide then.
- Dashboard → Vercel/Netlify reading Supabase; agent on-demand (serverless or local).
- Staleness monitor: Telegram if today's EOD run is missing; CI grep-guard failing on
  accidental token/secret patterns.
- ✅ Done when: hosted dashboard shows live data; a deliberately-skipped local run triggers
  the staleness alert.

---

## 6. Cross-cutting guardrails (enforced in code, not just policy)

- **Two-layer tool allowlist:** broker MCP clients expose only whitelisted tool names
  (e.g. `get_holdings`, never `place_order`); on the agent side, opencode `tools` config
  + per-agent overrides disable everything outside the read-only allowlist (§2b).
  Order place/modify/cancel tools are never referenced anywhere. For self-hosted Kite MCP
  use `EXCLUDED_TOOLS`; the hosted instance already excludes destructive tools. Our
   Groww wrapper never registers write tools at all.
- **Secrets:** tokens only in gitignored `data/tokens.json`; redaction filter on all
  logging; snapshots contain holdings, never credentials; CI grep check.
- **Read-only scopes** requested wherever a platform allows configuring them; where it
  doesn't, the allowlist is the boundary.
- **Determinism boundary:** Phases 1–4 and 6 produce identical output for identical input;
  LLM touches only Phase 5 and the dashboard chat.
- **No automated login** against Zerodha's/Groww's stated policy — daily manual
  browser login only (regulatory requirement, see §2).

## 7. Key risks

- Hosted MCP tool names/response shapes can drift → inspect-first step in every broker
  milestone; pin samples in `samples/` for regression comparison.
- Groww token-lifetime assumption → verify against real docs before building
  its automation (Groww docs are a JS app — needs an authenticated look).
- Moomoo hosted MCP tool coverage is unknown until we authenticate → M2 spike decides
  hosted MCP vs OpenD+SDK fallback.
- Trade history is same-day-only on Kite → XIRR quality depends on how early daily trade
  capture starts (M3).
- opencode server API is session-based → turn budgets enforced client-side (abort +
  event-stream counting); validate this in M7 spike before building the full eval set.
- Time-series value compounds with age → start M1 snapshotting ASAP.

## 8. Start here

1. M0 scaffold (repo, uv project, schema v1, redaction logging).
2. M1 step 1: connect to `mcp.kite.trade/mcp`, list tools, dump raw holdings to `samples/`.
3. M1 step 2: Zerodha session helper (daily browser login flow).
