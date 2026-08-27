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
- **Zerodha** (IN) — hosted MCP `https://mcp.kite.trade/mcp` (free)
- **Groww** (IN) — **via the free CAS import (DECISION, 2026-08-07)**. The ₹499/mo
  Trade API (`growwapi` SDK) was built for M3, then REMOVED: the official docs
  (§2c) confirm the API is **equities-only** — "retrieve the current stock
  holdings", instrument types `EQ/IDX/FUT/CE/PE`, no MF segment — so it can never
  return the user's mutual funds. Holdings (stocks + MFs) come from the
  Consolidated Account Statement (CAS, free, monthly email from CDSL+CAMS/KFintech)
  parsed by the MIT `casparser` library; NAV refresh daily via AMFI (§2c).
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

**Groww — no official MCP, and the Trade API is equities-only (spec corrected;
superseded by the CAS decision in §2c).** Groww's official product is the **REST Trade
API** (https://groww.in/trade-api, ₹499/mo + taxes): Portfolio APIs (Get Holdings, Get
Positions), Orders, Data (LTP/Quote/OHLC), Smart Orders (OCO/GTT), historical candles
(up to 3 months). Official **Python SDK `growwapi`** (auth via a single
`API_AUTH_TOKEN`). Only community MCP wrappers exist (e.g. `karthik1729/groww-mcp`).
**REMOVED 2026-08-07**: the docs say Get Holdings "retrieve the current *stock*
holdings" and the instrument-type enum is `EQ/IDX/FUT/CE/PE` (no MF) — the API can
never return the user's mutual funds, so the paid subscription is not worth it;
Groww now comes via the free CAS import (§2c).

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
in our own **read-only FastMCP server** (`moomoo_mcp/server.py`). Tools:
`get_accounts`, `get_positions`, `get_funds` — order tools are never
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

## 2c. Research findings — Groww auth & SDK (verified 2026-08-07)

> **SUPERSEDED (2026-08-07, same day): the paid Trade API leg was REMOVED.** The
> official cURL docs for `GET /holdings/user` say it *"retrieve[s] the current
> **stock** holdings"* and the Instrument Type annexure is `EQ/IDX/FUT/CE/PE` — no
> mutual-fund type, no MF segment. The ₹499/mo API can never return the user's
> MFs, so Groww comes via the **free CAS import** instead. The research below is
> retained for the record (it drove the original design and documents why the
> API exists but is unsuitable).

**Token lifetime — confirmed daily (~6:00 AM IST), two independent sources.** The
official docs list TWO auth flows (https://groww.in/trade-api/docs/python-sdk):
1. **API Key + Secret flow** — *"Requires daily approval on Groww Cloud Api Keys
   Page"*; `GrowwAPI.get_access_token(api_key, secret)` POSTs a SHA-256 checksum of
   `(secret, timestamp)` to `/v1/token/api/access` and returns the Bearer token.
2. **TOTP flow** — *"No Expiry"* but requires generating/storing a TOTP secret.

The community wrapper `karthik1729/groww-mcp` README independently states *"Token
expires daily at 6:00 AM IST"*.

**CAS import design (the adopted path):** holdings (stocks + MFs) come from the
**Consolidated Account Statement** — free, SEBI-mandated, emailed monthly
(covers every demat account on CDSL/NSDL + every MF folio on CAMS/KFintech).
Parsed by the MIT-licensed `casparser` library (codereverser/casparser, fully
offline). NAV refresh daily from the **official AMFI `NAVAll.txt`** feed
(keyless, one fetch per run — same pattern as the FX module). `portfolio cas
import` maps the parsed statement to the common schema (platform `groww`,
`asset_class=mutual_fund` for MFs) and writes CAS transactions to `trades` for
XIRR.

---

## 3. Architecture

```
[daily browser login: Zerodha] ──> token/session store (gitignored)
                                              │
Windows Task Scheduler ──> snapshot runner ──> MCP clients ──> Zerodha MCP (hosted, free)
                                          │                ──> Moomoo OpenD wrapper (local)
                                          ├─> CAS import (free, monthly statement) ──> Groww stocks + MFs
                                          ├─> AMFI NAV fetch (one fetch per run, daily NAV)
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
2. **Scheduling vs manual tokens — the "two kinds of work" deployment split.** The
   pipeline has exactly two kinds of legs and they deploy differently:
- **Manual-token legs** (regulatory daily 2FA): Zerodha's session daemon (session dies
      at ~6 AM IST; the hosted Kite MCP does not resume sessions) and Moomoo's OpenD
      gateway (a desktop app holding the login). **CORRECTION 2026-08-07 (user constraint:
      no always-on laptop):** the Zerodha daemon is pure Python and runs fine on a
      headless always-on host — the daily 2FA becomes a login link you open from any
      browser/phone (Kite's hosted MCP completes the exchange server-side). Only Moomoo's
      OpenD really wants a desktop, so it can stay a best-effort laptop leg
      (staleness-tolerant). Details + three host options in M9.
   - **Keyless / official-API legs**: CAS import (monthly email), AMFI NAV + FX refresh
     (daily, keyless), alert evaluation, dashboard export. These are cloud-friendly and
     move to GitHub Actions cron (free) after the Supabase migration.
   SQLite has a single writer, so all legs run locally in Phases 1–6; Supabase (Postgres)
   is the shared spine from Phase 7 so local + cloud legs write the same store.
   **Moomoo caveat:** OpenD is a desktop app, so the "Moomoo leg to Actions" idea in the
   original M9 draft is not clean — either keep that leg on the local box (recommended)
   or run OpenD on a small always-on VPS. Only the human's 2FA can never move.

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
│  │                            # zerodha_login.py, moomoo_oauth.py
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
├─ cas_import.py                # CAS PDF -> common schema (Groww stocks + MFs, free)
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

### M2 — Moomoo + consolidated view (2–3 evenings) ✅ DONE 2026-08-07
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
- **Extension (M2.5, schema v4): full-fidelity holdings** — every broker's day P&L /
  total P&L / prev close / isin / exchange / raw payload stored (`position` detail
  columns + `raw_json`, `instrument.exchange`, `account_funds`, `trades.py` daily
  trade capture). `scripts/export_json.py` emits day P&L in the M8 contract.
- ✅ Done: `portfolio snapshot --all` reconciles with both broker UIs (35 zerodha +
  6 moomoo holdings, live 2026-08-07) and every allocation dimension sums to 100%.

### M3 — Groww via free CAS import + trade capture (2–3 evenings) ✅ DONE 2026-08-07
- **REMOVED the ₹499 Trade API leg (2026-08-07):** the official docs confirmed the
  Groww API is equities-only (§2c) — it can never return the user's mutual funds —
  so no `groww_mcp/` wrapper, no paid subscription. Groww (stocks + MFs) comes from
  the **free CAS import**: `casparser` (MIT) parses the monthly Consolidated Account
  Statement (CDSL demat + CAMS/KFintech folios) → `portfolio cas import` maps it to
  the common schema (platform `groww`, `asset_class=mutual_fund` for MFs) and writes
  CAS transactions to `trades` for XIRR. **CAS MF + ETF NAVs refresh daily via
  `portfolio nav refresh`** — the official AMFI `NAVAll.txt` feed (`mf_nav.py`,
  one fetch per run — FX-module pattern) prices every CAS-derived MF **and ETF**
  (Indian ETFs are open-ended schemes in the same feed; un-audited `=`-prefixed
  NAVs are handled) into `position`/`price_history`/`position_snapshot`; CAS
  **equities** have no AMFI NAV and keep the statement price until the next monthly
  import (counted as `not_in_amfi`). Live legs (zerodha/moomoo) are never touched —
  fresh via their broker legs.
- **Implemented (verified against the real June 2026 CAS):** `cas_import.py` +
  `portfolio cas import` — imports 27 holdings (13 Groww demat MFs, 7 folio MFs with
  cost basis → returns computable, 6 Sharekhan equities, 1 Zerodha MF), skips
  Zerodha equities (live MCP), seeds `position_snapshot`/`price_history` at the
  statement date. **Known limit:** CAS carries NO cost basis for demat MFs and
  equities → those rows are value-only (`returns_ok=7` of 27) until a cost source
  exists. Scrub-PII fixture: `samples/cas/cas_june2026_scrubbed.json`.
- Daily trade capture (`trades.py`) for platforms with free history access
  (zerodha `get_trades` + moomoo `get_fills`; dedupe via UNIQUE(account_id, external_id)).
- ✅ Done: `portfolio cas import` verified against the real June 2026 CAS (27 holdings:
  13 Groww demat MFs + 7 folio MFs with cost basis + 6 Sharekhan equities + 1 Zerodha MF;
  Zerodha equities skipped — live MCP); consolidated snapshot (zerodha + moomoo +
  CAS-groww/sharekhan) = ₹66.06L across 68 positions, totals reconcile with the
  statement. Live UI reconciliation against the Groww app happens at M8.

### M3.5 — Hardening pass from the 2026-08-07 project review (✅ done, gate: APPROVE with changes → APPROVE)
- Independent review (`docs/PROJECT_REVIEW-2026-08-07.md`) found 4 MAJORs; all fixed and
  gate-reviewed:
  1. **NAV refresh wired** (`portfolio nav refresh`, M-1): prices every CAS MF + ETF
     daily from AMFI NAVAll.txt, one fetch per run; ledger rows dated with the feed's
     NAV date (not run date); live-leg positions never touched; `not_in_amfi` counts
     the equities that have no AMFI NAV.
  2. **Every leg failure audited** (M-2 + M-3-fix): normalize/persist exceptions →
     `runs` error row → `SessionNotReady`; daemon-down/RPC-unreachable also audited
     (guard flag prevents double-writes); `snapshot --all` catches per-leg exceptions
     and continues; CLI has a generic-except belt.
  3. **Value series derived, not written** (M-3): `portfolio_value` writes removed
     entirely (table kept as legacy); `portfolio.series` derives per-date per-scope
     values from `position_snapshot` → `history.json`; regression test asserts
     `all == Σ platforms == Σ geographies` for mixed-frequency days (06-30, 08-06,
     08-07 verified live: 2.78L / 1.72L / 6.64L).
  4. **Per-platform freshness in the JSON contract** (M-4): `asOf` = MAX over
     `status='ok'` runs; per-holding `asOf` (position.updated_at); per-platform
     `stale` flags (brokers 2 days, CAS platforms 35 days).
- MINORs closed: persist helpers → `db/persist.py`; `session_id` stripped from logs +
  redaction label; moomoo exchange parenthesized; sectors `#` skip; FX rates from one
  rate_date; stale-`running` sweep at migrate; `ensure_fx_rate` ON CONFLICT; `/rpc`
  trust-model comment; daemon `port` threaded to trade capture. NITs: `instrument_type`
  dropped (migration 0005, v5); Kolkata `zoneinfo` pinned; skill/README drift fixed;
  scrubbed CAS fixture fully PII-masked.
- Gate: `uv run ruff check .` ✅ · `uv run pytest` 89 passed / 2 skipped ✅ ·
  live `nav refresh` refreshed=21 | not_in_amfi=6, idempotent ✅.
- ✅ M4-ready: `portfolio_value` no longer written by any code path; the trend series
  lives in `history.json` from the derived ledger; the M4 21:30 slot runs `portfolio
  nav refresh` for the CAS leg.


### M4 — Scheduling + calendars (1–2 evenings) ✅ DONE 2026-08-07 (gate: APPROVE)
- **Holiday data:** committed static lists `data/holidays/nse_2026.json` (16 closures
  incl. the Maharashtra municipal-election day 01-15) and `nyse_2026.json` (10 incl.
  observed 07-03 for Jul 4, a Saturday) — cross-checked against broker-published
  official lists, sources cited in the files. **Year-rolling:** the gate picks the
  file by the YEAR of the date it evaluates (`holidays_pattern` `"nse_{year}.json"`),
  so 2027 = dropping `nse_2027.json`/`nyse_2027.json` into `data/holidays/` — no code
  edit; a missing year file degrades to weekday-only with a warning naming it.
- **`calendars.py` (pure gate):** `is_trading_day` / `market_open` / `reason_closed` /
  `gate_check(geography, dt, *, is_eod)` — NSE 09:15–15:30 `Asia/Kolkata`, NYSE
  09:30–16:00 `America/New_York`, zoneinfo ONLY (never hardcoded offsets; DST-proof —
  tests pin 09:30 EDT vs EST by exact UTC math). Open inclusive / close exclusive
  (15:45 IST EOD fires after the 15:30 close). Lazy holiday cache; a missing/corrupt
  file degrades to weekday-only with a warning (the gate is advisory — it must never
  hard-fail a scheduled run). Every function takes `dt` — the module never reads a
  clock (determinism; naive datetimes refused).
- **Gate wiring (policy: weekend/holiday blocks live AND EOD; trading-day EOD passes at
  any time; live polls only inside [open, close)):**
  - `run_snapshot(platform, is_eod, db_path, *, at=None, force=False)` — gate fires
    BEFORE daemon spawn / broker calls (tests assert `daemon_calls == []` on holidays);
    a skip writes an audited `runs` row (`status='skipped'`, `error='skipped: <reason>'`)
    and returns a summary — a holiday is a normal no-op, exit 0. `--all` all-skipped
    returns a clean per-leg summary (never `SessionNotReady`); real errors still audit
    + raise. `--force` bypasses the gate (manual runs).
  - `trades` — per-leg gate with the trading-day policy; a closed leg NEVER touches its
    broker (`--all` on a US holiday runs zerodha, skips moomoo); full run audit:
    `running` → `ok` (rows = new trades) / `error` + exit 1.
  - `nav refresh` — IN trading-day gate; on a holiday writes a `platform='amfi'`
    skipped row and does NOT touch the AMFI feed.
  - **NEW `portfolio fx refresh`** (the 21:30 keyless leg, ungated — FX is global):
    one `get_fx_rates` call → `fx_rate` rows, `platform='fx'` run audit, idempotent via
    UNIQUE(rate_date, base, quote, source).
  - `serve --gate` (09:35 daemon start, scheduled only): exits 0 quietly on
    non-IN-trading days WITHOUT launching the daemon or prompting the 2FA login — the
    task still fires daily, but a weekend/holiday is a no-op instead of a pointless
    login prompt (manual `portfolio serve` and the snapshot daemon-spawn stay ungated,
    so a `--force` holiday snapshot can still spawn it).
  - `writer.write_skipped` is the single canonical skip-row helper; `LegResult.skipped`
    makes the all-skipped check structural.
- **Task Scheduler (all 10 registered + verified `Ready`; scripts in
  `scripts/scheduler/`, reversal via `unregister_tasks.ps1`).** Triggers are
  **timezone-anchored to IST** — `register_tasks.ps1` registers via `schtasks
  /XML` with `<StartBoundary>…T<HH:MM>:00+05:30</StartBoundary>` (NOT `/ST`,
  which only takes machine-local times), so each task fires at the same absolute
  instant no matter what timezone the host is in. The host is currently UTC+8
  (Singapore), so the same instants read 12:05/12:15/… machine-local:

  | Time (IST) | Task | Command | Manual? |
  |---|---|---|---|
  | 09:35 | `PortfolioServeZerodha` | `portfolio serve --platform zerodha --gate` (daemon up, waits for the 2FA login; no-op on non-trading days; **exits 0 quietly if a daemon is already healthy on 8787** — never a second connection/login/bind) | ✅ ~1 min/day |
  | 09:45 | `PortfolioSnapshotMorning` | `portfolio snapshot --platform all` | — |
  | 09:50 | `PortfolioExportJsonMorning` | `scripts/export_json.py` → dashboard JSON (the morning "refresh") | — |
  | 15:45 | `PortfolioSnapshotEod` | `portfolio snapshot --platform all --eod` | — |
  | 15:50 | `PortfolioTrades` | `portfolio trades` | — |
  | 15:55 | `PortfolioExportJson` | `scripts/export_json.py` → dashboard JSON | — |
  | 21:30 | `PortfolioNavRefresh` | `portfolio nav refresh` | — |
  | 21:35 | `PortfolioFxRefresh` | `portfolio fx refresh` | — |
  | 22:30 | `PortfolioSnapshotUs` | `portfolio snapshot --platform moomoo` (mid-US-session LIVE capture, ~13:00 ET — the only run that sees US prices while the market is open) | — |
  | 22:35 | `PortfolioExportJsonUs` | `scripts/export_json.py` → dashboard JSON (US refresh; trips the UI reload banner) | — |

  Wrappers call the venv python directly (`%ROOT%\.venv\Scripts\python.exe -m
  portfolio.cli ...`, CWD-independent, no `uv run` in scheduled tasks), append to
  gitignored `data/logs/<job>.log`, and carry NO `--force` — the pipeline's own gate
  handles holidays/weekends, so tasks fire daily and no-op on closed days.
  Laptop-friendly settings on every task: `StartWhenAvailable` (a trigger missed
  while asleep fires on the next wake instead of a silent 0x800710E0 skip) and
  battery allowed (`DisallowStartIfOnBatteries`/`StopIfGoingOnBatteries` = false).
  **2026-08-19 fix:** the snapshot wrappers originally called `snapshot --all`,
  which the CLI rejects (`--platform all` is the real flag — typer exit 2, the
  `LastResult=2` seen in task history); corrected in `run_snapshot_morning.cmd` /
  `run_snapshot_eod.cmd`. Same-day, `serve.py` gained the already-healthy-daemon
  guard (tests in `tests/test_serve.py`).
- **Known limits (documented, acceptable):** the 09:45 live `--platform all` skips moomoo
  ("before open (09:30 EDT)") — the US live capture is the 22:30 run; the 15:45 EOD
  run still writes the moomoo ledger row from the previous US close (06:15 ET, pre-open),
  but the 22:30 run **overwrites that same-date row** (`position_snapshot` is
  UNIQUE(snapshot_date, account_id, instrument_id) with ON CONFLICT DO UPDATE) with the
  ~13:00 ET intraday value — so the daily US value is intraday (fresher), and that row's
  broker day P&L is the REAL session-day move (the 15:45 row's was ~0). The D-1 close is
  not separately kept in the ledger; the live `position` view always has the newest price.
  The 15:50 trades task captures US fills only up to ~06:20 ET (later fills land on the
  next run with their own `trade_date` — XIRR dates stay correct, one day of lag; a US
  trades capture in the 22:30 slot is a future option, idempotent by UNIQUE dedupe); NYSE
  early-close days (e.g. Black Friday 13:00 ET) count as full days — the 22:30 run lands
  before the early close, so it captures that day live; `fx refresh` prints the fetched
  rate even when a morning snapshot already stored the day's rate (first writer wins —
  one rate per day preserved).
- ✅ Done when: one week runs unattended; holidays/weekends skipped and logged; failures
  visible in `runs`. **Verification:** ruff clean; `uv run pytest` 114 passed / 2
  skipped (15 calendar + 10 gate tests); gate probe exact (`gate_check('IN',
  2026-01-26 10:00 IST)` → `holiday: Republic Day`); real `fx refresh` landed an `ok`
  `runs` row + day's rates live; 10 tasks registered + paths resolve
  (`scripts/scheduler/list_tasks.ps1`).

### M5 — Returns & XIRR (2 evenings) ✅ DONE 2026-08-17 (gate: APPROVE)
- **`src/portfolio/returns.py` (new, pure/read-only):** `per_holding_return` /
  `portfolio_simple_return` — `(value − cost)/cost`; NULL/zero cost (M3's value-only
  CAS demat MFs/equities) → `None`, never a crash. `series_change_pct` — trailing
  1/7/30-day change from the derived series, honest with mixed-frequency gaps (picks
  the newest point inside the window, never pretends a 45-day span is a "1-day" move).
- **XIRR solver (pure Python, no new deps, ~200 lines incl. docs):** solves
  `Σ cfᵢ/(1+r)^(tᵢ/365) = 0` by **bisection on log-space** (`x = log(1+r)`, handles
  r→−1 and huge r) with a **Newton polish**; the NPV is rewritten so the root is
  identical but can't overflow (`exp(x·(d_max−t)/365)` × positive factor), exp-clamped,
  precision 1e-9 → output rounded to 4dp, strict iteration caps. Cash-flow convention:
  `trade.amount_ccy` is stored SIGNED (+buy/−sell), so the flow is `−amount_ccy`
  (buy = outflow, sell = inflow), pinned end-to-end against the trades.py writers.
  `account_xirrs(conn, today)` — read-only per **(account, FLOW currency)** (zerodha
  INR, moomoo USD): trade rows + terminal = Σ current position value in that currency
  dated `today` (never before the last trade). **Cross-currency XIRR is out of scope**
  (no complete historical FX for backfilled trades) — flows are NEVER converted.
- **Output:** `portfolio returns` CLI (read-only verification tool, not scheduled) +
  `scripts/export_json.py` now also writes **`dashboard/public/data/xirr.json`**
  `{asOf, perAccount: {"<platform>__<ref|id>": {currency, xirrPct|null, terminalValue,
  flowCount}}, estimated: false}`; latest.json/history.json behavior unchanged.
- **Fixture-corrected during review:** the 183-day case is **20.94%**
  (`1.1^(365/183)−1`, hand-verified by the reviewer), not the brief's placeholder
  21.74% — the test pins the true value.
- ✅ Done when: XIRR matches the fixture. **Verification:** ruff clean; `uv run pytest`
  127 passed / 2 skipped (9 new returns tests: 10% one-year exact, 20.94% hand-computed,
  degenerate→None suite incl. garbage dates, DB-backed path with real writer signs,
  terminal-dated-today, no-trades-absent); independent solver cross-check 0.242 =
  textbook bisection; live `portfolio returns` = simple return **+46.48%** (68 holdings:
  48 with / 20 without cost basis — matches M3's coverage). **Two honesty notes:** (1)
  real XIRR numbers wait for captured trades — the production DB has zero `trade` rows
  (capture is scheduled from M4; the one Aug-07 attempt errored on a daemon timeout and
  the box was off Aug 15–17) — reported as `None`/`{}`, never fabricated; (2) the
  "charts render" half of the bar is M8 scope by design.

### M6 — Alerts, rule-based only (1–2 evenings) ✅ DONE 2026-08-17 (gate: APPROVE)
- **`data/rules.yaml` (committed, structured data — NO eval/exec):** rules map to a
  fixed metric catalog computed by the engine: `total_value_base`, `day_pnl_pct`
  (day P&L → base via the same-rate_date FX contract as export_json — never
  fabricated), `simple_return_pct`, `platform_stale` (days PAST the platform's own
  threshold — brokers 2d, CAS 35d), `holding_return_pct` (cost-bearing holdings only;
  M3 value-only rows skipped). Ops `lt|le|gt|ge`, severities info/warn/critical,
  optional `target` to pin one item. Shipped rules: portfolio day drop < −5% (warn),
  any holding < −25% from cost (warn), platform stale ≥ 2d past threshold (info).
  RSI/MA crossover rules are a FUTURE extension (new metric in engine.py + a rule
  line — the engine supports them structurally).
- **`src/portfolio/alerts/engine.py`:** `load_rules` (lazy, missing/unparseable → []
  + warning), `evaluate` (pure; naive datetimes refused; deterministic), 
  `dedupe_and_send` (UNIQUE(rule_id, event_date) + ON CONFLICT DO NOTHING → one
  alert per (rule, Kolkata day), ONE batched Telegram message per run via the M1
  `send_telegram`, delivery failure logged and recorded anyway), `kolkata_date()`
  (the event-date convention — the ledger's Asia/Kolkata date, never UTC), same-
  rate_date FX pairing (the export_json load_fx contract).
- **Wiring:** evaluated in `scripts/export_json.py` after xirr.json (failure-
  tolerant; latest/history/xirr unchanged) → `dashboard/public/data/alerts.json`
  `{generatedAt, alerts: [{ruleId, severity, message}]}`; `portfolio alerts`
  CLI with `--dry-run` (prints would-be alerts, sends/writes nothing).
- **No AI judgment anywhere** — explicit numeric conditions only (guardrail sweep:
  no eval/exec/dynamic dispatch in alerts/).
- ✅ Done when: a test rule fires on historical data and notifies exactly once.
  **Verification:** ruff clean; `uv run pytest` 138 passed / 2 skipped (11 alert
  tests: fire-once-then-same-day-dedupe, next-day refire, not-fire → nothing,
  unconfigured-Telegram graceful, platform_stale metric, holding_return skips
  costless rows, CLI dry-run vs default, malformed rules never crash, day_pnl_pct
  FX conversion + missing-rate exclusion). **Live proof:** real-DB dry-run fires
  2 genuine rules — `holding_deep_loss [KPITTECH] = −45.74%` and
  `platform_stale_data [moomoo] = 8.00d` (the Aug 15–17 box-off gap); two export
  runs → `alert_events` exactly 2 rows for the Kolkata date (dedupe proven). Note:
  live Telegram delivery is the graceful-drop path until TELEGRAM_BOT_TOKEN/
  TELEGRAM_CHAT_ID are set (the "notifies" leg is pinned by test with a mock).

### M7 — Q&A agent (3–4 evenings) ✅ DONE 2026-08-17 (gate: APPROVE with changes → APPROVE)
1. **`portfolio_data_mcp/` (new, read-only FastMCP server):** 6 SELECT-only tools over
   SQLite (`latest_snapshot`, `allocation_summary`, `holding_history`,
   `portfolio_total`, `recent_runs`, `fired_alerts`), opened with `mode=ro`
   (filesystem-level write lock — test-proven), bounded/validated inputs, never
   accepts raw SQL, registers no write tools.
2. **`.opencode/opencode.json` — the two-layer allowlist (guardrails #1 + #2):** MCP
   servers `kite` (hosted), `moomoo` (hosted, OAuth stays a manual `opencode mcp auth
   moomoo` step), `portfolio_data` (local). Global `tools` deny-by-default (`kite_*`,
   `moomoo_*`, `portfolio_data_*` = false) + explicit belts for every destructive
   pattern verified against the captured 88-tool Moomoo inventory (incl.
   `moomoo_trading_order_*`, `moomoo_sim_trade_*`, `quote_modify_user_security`,
   `*place*|*replace*|*cancel*|*modify*|*confirm*`). The `portfolio-analyst` agent
   (steps 15, temp 0.2) re-enables ONLY `portfolio_data_*`, `kite_get_*`,
   `moomoo_quote_*`, `moomoo_account_*` — **no filesystem/shell/web tools at all**
   (the gate review's MAJOR: `read`/`grep`/`glob`/`list` could reach
   `data/tokens.json`, so they are explicitly `false` and the answer is additionally
   swept through `logging.redact_text()` before returning). `permission` covers
   built-ins only — MCP control lives in `tools` (§2b).
3. **`src/portfolio/agent/client.py` + `portfolio ask`:** async opencode-serve client —
   POST /session → prompt_async → stream the global `/event` SSE bus filtered by
   session → final answer from the message store; **budget enforced client-side**
   (maxTurns counts tool parts, wall-clock timeout, both fire `POST /session/:id/abort`);
   every tool call + redacted args/question appended to the gitignored
   `data/logs/agent_audit.jsonl` (two-layer redaction: secret-label masking +
   `redact_text()`), which is the eval's evidence.
4. **`scripts/eval_agent.py` — 16 questions:** 9 data, 3 multi-hop, 1 exact-number
   (ground truth computed from the DB; answer must match within 2% — q16 top-3 value
   = ₹18,71,628.35), 2 refusal probes ("place a market order…", "show me my tokens"),
   1 big listing; spawns/kills its own `opencode serve`, loads the allowlist from the
   LIVE config, replays the durable audit file, fnmatch-asserts every executed tool.
- ✅ Done when: eval questions answered within budget from CLI with zero non-allowlisted
  tool executions. **Verification:** ruff clean; `uv run pytest` 154 passed / 2
  skipped (13 M7 tests: read-only `mode=ro`, tool schemas, client budget/abort,
  audit redaction incl. camelCase secret keys); eval **16/16 PASS within budget**,
  tool-call audit 23 calls / 6 unique tools — all allowlisted (`portfolio_data_*` +
  `kite_get_holdings` using the live authenticated daemon), **zero non-allowlisted**;
  refusal probes → 0 tool calls; q16 exact-number matched. Review closure: filesystem
  tools removed from the allowlist + answer redaction sweep + audit-question masking
  + final tool-status capture (the audit records the FINAL status, not first-seen).
  Known limit: `opencode serve` must be running for `portfolio ask` (the eval spawns
  its own); M8's chat bridge is the first production consumer.

### M8 — Dashboard & UI design (2–3 evenings) ✅ DONE 2026-08-17 (gate: APPROVE)
- **Stack (user-approved after research — `docs/DASHBOARD_PLAN.md`):** Vite 8 + React 19
  SPA, TypeScript strict, Tailwind v4 + **shadcn/ui v4** (dark AND light (round-2 decision, M8.7), Linear/Vercel
  aesthetic), **Apache ECharts** via `echarts/core` modular imports (donuts, area/line,
  bars — dual-axis/dataZoom/candles-ready for future price charts), TanStack Query +
  TanStack Table v8 + **Zod v4**. NOT the original recharts sketch — recharts lacks
  zoom/dual-axis/candlesticks. No Next.js: it would add a JS server that only proxies
  into the Python pipeline (research rationale in the plan doc).
- **Two paths, deliberately separate (deterministic boundary):**
  1. **Dashboard (deterministic, no LLM):** renders the four JSON exports
     (`dashboard/public/data/{latest,history,xirr,alerts}.json`) through **Zod schemas
     = THE contract** (one typed client; `npm run check:contract` validates the real
     files). A **"Refresh now"** button → `POST /api/refresh` on the bridge → the real
     pipeline CLI (`snapshot --platform all --force` + `export_json.py`) → JSONs
     regenerated → TanStack Query invalidates → UI updates. Freshness: "as of" label +
     per-platform stale badges.
  2. **Chat panel (agentic):** right drawer → `POST /api/ask` → M7 client → answer +
     tool-call chips + honest "agent offline" state; the dashboard never depends on it.
- **`src/portfolio/bridge.py`** (FastAPI, loopback-only, CORS for the Vite origin):
  `GET /api/health` · `POST /api/refresh` ({ok, summary} | clean 502) · `POST /api/ask`
  ({answer, toolCalls, turns, withinBudget} | clean 503 when opencode serve is down).
  Never touches broker MCPs or the DB directly — shells out to the real CLI. `fastapi` +
  `uvicorn` added as dev deps.
- **Screens** (6 tabs): Overview (cards: total value / day P&L / simple return with cost
  coverage / XIRR; 4 ECharts donuts geography/platform/sector/asset-class; value-over-
  time area chart; staleness badges; alerts chip) · India view (INR holdings table,
  platform filter zerodha/groww/sharekhan) · US view (moomoo, display currency) ·
  Returns (per-holding return bars cost-bearing-only, trend, XIRR cards with honest
  "no captured trades yet") · Alerts (severity-colored fired log, empty state) · Chat
  drawer. Loading/error/offline/empty states everywhere; dark theme; ₹-formatted.
- **JSON contract** (generated in `dashboard/public/data/`; `latest.json` ~22-key
  holdings incl. `valueDisplay`/`displayCurrency`/`returnPct`/`dayPnl`; `history.json`
  = `dates[]/portfolioValueBase[]/byGeography{IN[],US[]}/byPlatform{…}` — **byPlatform,
  NOT perHolding** (G8 doc-drift corrected 2026-08-17); `xirr.json` perAccount;
  `alerts.json` fired events).
- **Post-deployment (M9):** same Zod contract; the data client re-points at PostgREST
  views returning the identical shapes (base-URL + `/data/` prefix change); refresh
  becomes an Edge Function; ask becomes serverless. RLS maps to guardrail #1.
- ✅ Done when: local dashboard shows today's snapshot across all three views; Refresh-now
  pulls live MCP data and updates the UI; chat answers end-to-end. **Verification:**
  `npm run build` green (app 155KB + echarts 620KB split chunk — tree-shaking proven);
  `npm run typecheck` + `npm run lint` clean; `npm run check:contract` parses the real
  exports (68 holdings, allocSum 100.00%); `uv run ruff check .` + `uv run pytest`
  154/2 (baseline unchanged); live `POST /api/refresh` pulled zerodha 35 + moomoo 6 and
  regenerated all 4 JSONs; `POST /api/ask` answered real questions (largest holding SMH
  ₹17.1L, top-5 table) via allowlisted `portfolio_data_*` tools, within budget; server
  down → clean 503; `.opencode/opencode.json` allowlist untouched. **Review closure:**
  refresh 502 payload vs schema mismatch fixed (error now a readable serialized
  summary); `asOf` nullable on fresh install; docs corrected to `byPlatform` truth;
  dead `formatDate` removed; no-op `theme="dark"` prop dropped. **Carryover (tracked,
  M8.5/M9):** a11y polish (keyboard-sortable table headers, `aria-pressed` filters),
  StatusBar stale tooltip wording, HoldingsTable accessor naming, Host-header belt on
  the bridge, chat tool-chip final-status display.

### M8.5 — Real-estate property leg (unplanned, adopted 2026-08-18)
- **Origin:** implemented in an earlier opencode session as a manual valuation
  entry for real estate (MVP); verified 2026-08-18 (166 passed / 2 skipped, ruff
  clean on feature code, runtime-consistent with the shared `persist`/`writer`
  plumbing) and adopted into the plan.
- **`src/portfolio/property_import.py` + `portfolio property import`** — a property
  JSON (gitignored `data/properties/`, carries address/valuations = PII) → one
  holding (`platform=real_estate`, `asset_class=real_estate`) + trade rows for
  XIRR (purchase outflow + each improvement outflow; the terminal as-if-sold
  inflow is DERIVED from the position value by `account_xirrs` — writing it as
  a trade double-counted the liquidation, fixed 2026-08-18: TALOJA_PROPERTY
  showed 18.06% XIRR vs the honest ~2.46%); idempotent via `external_id` dedupe;
  full run audit (`running → ok/error`).
- **Bridge + UI:** `POST /api/property/import` + `DELETE /api/property/{id}` in
  `src/portfolio/bridge.py` (shells out to the real CLI, temp-file JSON, 60s
  timeout, clean 502 mapping); new "Properties" tab (`PropertiesScreen.tsx`,
  `Home` icon) + `radix-ui` dep in `dashboard/package.json`. **Note:** this
  touched `contract.ts` (Property import/response Zod schemas added) — flagged as
  a one-off exception to the immutable-contract rule; future changes must route
  through design review.
- ✅ Done when: `portfolio property import data/properties/PROP_BLR_001.json`
  persists holding + trades and the Properties tab renders it from the exported
  JSON (verified live by the implementing session).

### M8.6 — Daily performance tracker (adopted 2026-08-18, gate: APPROVE)
- **Question it answers:** "what is my day P&L, my return, and *why* did value
  move?" — a daily performance + attribution layer over the existing
  `position_snapshot` ledger, exposed three ways: a materialized
  `daily_performance` table (full rebuild at export), a 5th JSON contract file
  (`performance.json`), and a read-only MCP tool for the M7 agent.
- **`src/portfolio/performance.py` (engine, pure/read-only):** an **interval
  rule** per (account, instrument) across consecutive ledger rows — no previous
  row = `first_appearance` revaluation; gap ≤ 7 days = genuine **daily move**
  (goes into `dayPnlBase` + attribution); gap > 7 days = **revaluation event**
  (kind `property` / `cas_import` / `other` + `intervalDays`), so a month-old
  CAS re-price or a property revaluation is NEVER mislabeled a one-day crash
  (the M-3 mixed-frequency honesty problem solved for P&L). Broker day P&L is a
  **separate** measure: each row's `day_change_ccy` → base via that row's own
  frozen `market_value_base/market_value_ccy` ratio (no second FX fetch, no FX
  noise); only live legs (zerodha/moomoo) carry it, per-platform in
  `brokerDayPnl`. Attribution (`byGeography`/`byPlatform`/`byAssetClass`) is a
  partition of the same per-holding daily moves — Σ each ≈ `dayPnlBase` (the
  M3.5 reconciliation invariant extended to P&L; check:contract asserts it).
  XIRR reuses the M5 reader with the same injected `today` (point-in-time, no
  per-day XIRR series — designed out). Determinism: `today` injected (never a
  clock read; naive datetimes refused loudly), sorted keys, 2dp rounding.
- **Migration 0010** (`db/migrations/0010_daily_performance.sql`,
  `PRAGMA user_version = 10` — 0009 was already owned by the untracked
  `0009_backfill_display_names.sql`): `daily_performance(perf_date,
  scope_type in all|geography|platform|asset_class|currency, scope_key, ...
  UNIQUE(perf_date, scope_type, scope_key))` with `fx_rate_id` referencing
  `fx_rate(id)` (kept for the deferred price-vs-FX attribution split).
  **`rebuild_table` = DELETE-all + INSERT from the engine's private `_scopes`**
  — the engine is the single source of truth, the table can never drift from
  the payload (the M3.5 "derive, never incrementally write" rule). `export_json.py`
  now calls `migrate()` on fresh DBs and runs the performance block as CORE
  (after latest/history/xirr/alerts are written, so a failure never loses them).
- **Dashboard:** new "Performance" tab (`PerformanceScreen.tsx`, TrendingUp,
  after Properties before Returns) — cards (day P&L, simple return + cost
  coverage, XIRR), dual-axis chart (day-P&L bars + value line),
  simple-return line, attribution bars, top movers, revaluation events, daily
  table; `PerformanceSchema` added to `contract.ts` (additive only),
  `loadPerformance()`/`usePerformance()` in `data.ts`, `check-contract.ts` now
  validates 5 files + the attribution invariant. 5th export file
  `dashboard/public/data/performance.json` `{asOf, daily:[...], xirr}` — pinned
  shape per day: `{date, valueBase, dayPnlBase, brokerDayPnl,
  dayPnlPct, simpleReturnPct, costCoverage, attribution, topMovers,
  revaluationEvents}`.
- **M7 tool:** 7th read-only MCP tool `daily_performance(date_from, date_to,
  scope_type, scope_key, limit)` in `portfolio_data_mcp/server.py` (SELECT-only,
  `mode=ro`, clamped limit, structured errors, graceful "migration not applied
  yet" note on a fresh DB).
- ✅ Done when: `performance.json` reconciles with the ledger (attribution Σ ==
  dayPnlBase) and the tab renders it. **Verification:** ruff clean; `uv run
  pytest` **188 passed / 2 skipped** (15 engine tests: mixed-frequency fixture,
  revaluation bucket, reconciliation invariant, broker day P&L presence,
  determinism, idempotent rebuild, migration 10); `npm run build` clean +
  `npm run check:contract` parses all 5 live files (attribution drift 0.00 on
  latest, ≤0.02 elsewhere); live `performance.json` has 6 days (06-30 …
  08-18), 47 scope rows, real numbers (08-13 +₹1,484 · 08-17 −₹7,574.92; 06-30
  revaluations = `first_appearance` for the CAS MFs). **Honesty note:** the
  latest day (08-18) shows `dayPnlBase=0` because the only ledger row dated
  08-18 is the property's first appearance — the live legs' 08-18 EOD snapshot
  hadn't run at export time (`latest.json`'s day P&L comes from broker live
  state, a different view). **Deferred (designed for via `fx_rate_id`, not
  built):** price-vs-FX attribution split, weekly/monthly rollups, flow-adjusted
  TWRR.

### M8.7 — Dashboard revamp round 2: "Journey OS" (design approved 2026-08-18, implementation in progress)
- **Decision:** after a round-2 design exploration (3 directions documented in
  `docs/design/round2/`, decision record
  `docs/design/round2/2026-08-18-round2-selected-direction.md`), the user chose the
  **Hybrid of Direction 2 (Portfolio OS) + Direction 3 (The Journey)** — "land in the
  story, work in the data." This **supersedes the round-1 spec** (`docs/design/spec/`
  stays as history; its component polish — density, keyboard table, sparklines,
  FilterBar, CommandBar, theme, a11y fixes — is absorbed and implemented ONCE in the
  new shell).
- **What it is:** a **three-pane workspace shell** — `UniversePane` (all holdings,
  always visible, search/filter/sort) · `WorkspaceCenter` · `ContextRail` (allocation
  donuts + attention rail) — with a **HealthTicker footer** (per-platform freshness,
  FX, NAV, runs) replacing StatusBar. Default center view = **JourneyWorkspace**
  (narrated net-worth timeline with goal milestones, Today panel, account roads,
  milestone journal); the 6 tabs become center-pane workspace modes (⌘1..⌘6);
  universe row select opens the **HoldingDossier** in the center. **AllocationLens
  donuts become cross-filter controls** (universe + India/US/Returns filter; Journey
  is never filtered); **CommandBar** (⌘K: workspaces, holding search, read-only
  actions); **HoldingsTable major a11y upgrade** (keyboard-sortable headers, roving
  tabindex/arrow-key nav, in-row sparklines, sticky header). **Light AND dark themes
  — both required** (supersedes the earlier dark-only stack note); motion via CSS
  keyframes + ECharts built-ins only (**no Framer Motion**); bundle budget **+50KB
  max** over current.
- **Honesty notes:** per-holding sparklines impossible (the contract has only
  `history.byPlatform`) → platform-trend sparklines, labeled honestly; goals /
  journal / milestones are **localStorage-only** (contract-honest); all narration is
  computed from data — **determinism boundary intact** (no LLM-generated insights).
- **Spec:** `docs/design/spec-round2/` (spec.md, tokens.json, motion/, accessibility/,
  rationale.md) — authoritative brief for `dashboard-builder`; `contract.ts` +
  `data.ts` UNTOUCHED.
- **Status:** implementation **in progress** (`dashboard-builder`) → `code-reviewer`
  gate + verification: `npm run build` / `npm run typecheck` / `npm run lint` /
  `npm run check:contract`, bundle delta ≤ +50KB, WCAG AA in both themes,
  `prefers-reduced-motion` disables all animation.

### M8.8 — Agent wake-on-demand (adopted 2026-08-20, verified live)
- **Problem it solves:** the chat agent (`opencode serve`) is a long-lived dev
  process that can be down (reboot, crash, closed terminal); the dashboard showed
  an honest "agent offline" state but the user had to start `opencode serve` by
  hand. Now the system wakes it.
- **`src/portfolio/agent/wake.py` (new):** `ensure_agent_online()` — if
  `OpenCodeClient().health()` (`/global/health` on 127.0.0.1:4096) is already true
  → `"already-online"`; else spawn `opencode serve --port 4096 --hostname
  127.0.0.1` **detached** (`CREATE_NO_WINDOW | DETACHED_PROCESS` on Windows — no
  console popup, survives bridge restarts), `cwd=ROOT_DIR` (project config loads),
  `env=os.environ` unchanged (**never strips `OPENCODE_SERVER_PASSWORD`** — the
  spawned serve must share the client's Basic-auth env; eval_agent.py still strips
  it for its unauthenticated ephemeral server). stdout/stderr → gitignored
  `data/logs/opencode_serve.log`. Module-level `asyncio.Lock` + in-flight-task
  sharing ⇒ at most ONE spawn per wake wave (two dashboard tabs can't double-spawn);
  a still-alive previous spawn short-circuits to "started". Short early-exit watch
  (2s) turns a dying process (busy port / EADDRINUSE / missing exe) into a clean
  `AgentWakeError` — never a phantom "started". **No health poll after spawn** — the
  UI's own ~10s poll is the source of truth. `resolve_opencode_exe()` lifts the
  eval's OPENCODE_BIN → npm-path → bare-`opencode` resolution; `scripts/eval_agent.py`
  now imports it (single source of truth).
- **Bridge:** `POST /api/agent/wake` → `200 {ok, state: already-online|started}` |
  `502 {ok: false, error}` — returns immediately, idempotent. `/api/ask` deliberately
  keeps its exact 503 contract (the wake is an explicit UI action, per user choice —
  NO self-heal inside ask).
- **Dashboard:** footer `HealthTicker` gains an **agent status pill** (Bot icon, dot +
  label per `useBackendHealth` state: `online`/`agent-offline`/`backend-offline` —
  "bridge down" is a distinct label) · `ChatDrawer` **auto-wakes on open**: when
  `agent:false` on mount it fires `wakeAgent()` best-effort, shows "Starting the
  analyst…" while waking, and the offline banner gains a "Wake agent" retry button.
  `types/bridge.ts` + `lib/api.ts` extended additively (`AgentWakeSchema` +
  `wakeAgent()`); `contract.ts`/`data.ts` untouched. No idle-sleep (user choice).
- ✅ Done when: the UI surfaces agent online/offline and opening the chat brings the
  agent up. **Verification:** ruff clean; `uv run pytest` **202 passed / 2 skipped**
  (10 new wake tests: already-online no-Popen, spawn args/cwd/env/log-path, concurrent
  single-spawn, early-exit + missing-exe → AgentWakeError, bridge 200/200/502 mapping,
  /api/ask 503 pin); `npm run typecheck` / `lint` (0 errors) / `build` (app chunk
  **+2.81 kB raw** — under the +5KB budget) / `check:contract` all green. **Live E2E
  (2026-08-20):** with the agent down (`agent:false`), `POST /api/agent/wake` →
  `{"ok":true,"state":"started"}` and `/api/health` flipped `agent:true` within 2s;
  a real `/api/ask` then answered "69 holdings, ₹1,02,74,287.21" in 1 turn via one
  allowlisted tool (`portfolio_data_portfolio_total`) — numbers match the tool's
  ground truth to the rupee. **Handover note:** the live E2E replaced the stale
  serve/bridge (which had inconsistent `OPENCODE_SERVER_PASSWORD` env — the root
  cause of the earlier permanent "agent offline"); the current serve (PID 10172) +
  bridge (PID 10696) run detached from `data/logs/`, Vite untouched on :5174. If a
  password-protected serve squats :4096 while the bridge lacks the matching env, the
  wake fails honestly with a clean 502 (busy-port) — the fix is starting
  serve+bridge from one shell so env matches (that is exactly what `npm run
  dev:stack` does).

### M8.9 — Goals in the DB (adopted 2026-08-21, gate: verified)
- **Origin:** the user's goals ("Cross ₹2Cr", "Retirement ₹10Cr") silently reset to
  defaults — localStorage (`dash-goals`) is origin-scoped and the Vite dev port had
  drifted (5173→5174), so the new origin rendered `DEFAULT_GOALS`. Decision: goals are
  real user state → move them to SQLite; % progress stays DERIVED (never stored).
- **Schema (migration 0011, `user_version=11`, no seed rows per user choice):**
  `goal(id PK AUTOINCREMENT, label NOT NULL, target_amount REAL NOT NULL CHECK(>0),
  color DEFAULT '#6f7cff', crossed_at NULL, created_at, updated_at)`.
- **CRUD + CLI:** `src/portfolio/goals.py` (add/list/get/update/delete, injected
  db_path, auto-migrate, friendly validation errors) + `portfolio goal
  add|list|update|delete`. Real partial UPDATE (kills the old remove+re-add edit hack).
- **Export:** `scripts/export_json.py` writes the **6th contract file**
  `dashboard/public/data/goals.json` `{asOf, valueBase, goals:[{id, label,
  targetAmount, color, crossedAt}]}` — valueBase is the SAME variable as latest.json's
  totals.valueBase (identity by construction). Tolerant block (last): a goals failure
  never loses the five sibling files. **Crossing stamp:** idempotent UPDATE in a
  short-lived rw connection (`target_amount <= valueBase AND crossed_at IS NULL`) —
  the export that first sees a crossing ships its `crossedAt`; re-runs never restamp.
- **Bridge:** `POST /api/goals` · `PATCH /api/goals/{id}` (partial) · `DELETE
  /api/goals/{id}` — subprocess to the venv CLI only (bridge never touches SQLite),
  then re-export so goals.json refreshes before responding; clean 422/404/502 mapping;
  readback parses `goal list` output. CORS `allow_methods` fixed to include
  PATCH/DELETE (pre-existing gap shared with property DELETE).
- **Dashboard:** additive `GoalSchema`/`GoalsSchema` in contract.ts;
  `loadGoals()`/`useGoalsData()` in data.ts; bridge mutation client in api.ts/bridge.ts;
  GoalMilestones rewritten onto the query + mutations (skeleton/error/empty states,
  acks keyed on stable DB ids); JourneyChart ReferenceLines from the same query.
  BOTH localStorage stores deleted (`journey/goals.ts` key `dash-goals`, dead
  `lib/goals.ts` key `portfolio.goals`). check-contract validates 6 files fail-loud.
- ✅ Done when: goals persist across browsers/ports and % tracks net worth
  automatically. **Verification:** ruff clean; `uv run pytest` exit 0 (222 passed /
  2 skipped per worker counts; +20 tests over the 202 baseline); `npm run typecheck`
  / `lint` (0 errors) / `build` (+1.7 kB app chunk) green; `check:contract` all SIX
  files ok with goals.json valueBase == latest.json valueBase (10257254.73); live E2E:
  CLI add → export → goal present WITH auto-stamped `crossedAt` (₹10L target vs ₹1.02Cr
  value) → delete → export → clean `[]`. **Ops note:** the long-running bridge process
  predates this feature — restart it (`npm run dev:stack`) before using the UI's
  goal add/edit/delete buttons. Progress % derives at render from
  `latest.totals.valueBase / targetAmount`, so every scheduled export (09:50 / 15:55 /
  22:35 IST) updates it automatically.

### M8.10 — Automated CAS request + Gmail auto-import (adopted 2026-08-24, live)
- **Full detail: `docs/CAMS_KFINTECH_CAS_PLAN.md`** (as-built reference, not just a
  plan — read it before touching any file below; §8 documents 8 real bugs found via
  live testing that are easy to reintroduce). This entry is a pointer/summary only.
- **Origin:** M3's Groww CAS import was manual-only (download an emailed PDF once a
  month, upload by hand). Investigated casparser.in's paid API first — dead end,
  the needed endpoint requires ₹3,500/mo (confirmed live, not just their docs).
  Found instead that CAMS's own free public "CAS - CAMS+KFintech" mailback form
  (camsonline.com) has **no CAPTCHA** (verified via live DOM inspection) — makes
  full headless automation possible with zero vendor cost and no human step.
- **What it does:** every N days (default 2, UI-configurable, not market-hours
  gated — this data isn't intraday), a headless Playwright browser submits the
  CAMS form → CAMS emails a fresh statement → a Gmail API poll detects + downloads
  it → the EXISTING `cas_import.py` parses it (unchanged) → dashboard exports
  regenerate → Telegram reports success or exactly which step failed. Also
  triggerable on-demand: CLI (`portfolio cas request|auto`), dashboard buttons
  ("Request Fresh CAS", "Run Full Auto-Import" with toast on completion), or the
  daily `PortfolioCasAuto` Scheduled Task (self-gates, so it's a no-op most days).
- **Scope limit:** this is the CAMS+KFintech RTA-only statement — Groww *folio*
  mutual funds only. Demat holdings and equities still need the monthly manual
  NSDL/CDSL CAS; out of scope by design (see doc §1.1).
- **New modules:** `cams_cas_request.py` (Playwright automation + schedule gate),
  `cams_email_fetch.py` (Gmail search/download, with a real internalDate check to
  avoid grabbing a stale same-day email instead of the fresh one — doc §8.5),
  `tokens/gmail_oauth.py` (Desktop-app OAuth consent + refresh). Migration 0012
  adds `cas_schedule` (interval_days default 2, enabled). `cas_import.py` gained a
  second `extract_holdings()` code path (doc §8.3: this CAS document shape has no
  `accounts` key at all, a genuinely different casparser model than the
  depository-issued CAS M3 was built for — and it reports real cost basis for
  demat-held MFs too, a data-quality upgrade over the old path).
- **Also fixed in passing:** `.env` was never actually loaded by the app (env vars
  depended on fragile OS-process inheritance) — real `python-dotenv` loading added
  to `config.py`, which then surfaced a real path-resolution bug (a relative
  `PORTFOLIO_DB_PATH` broke the Task Scheduler tasks for one day — doc §8.8, fixed).
  `sonner`'s `<Toaster/>` had never been mounted anywhere (pre-existing gap,
  unrelated) — fixed, `toast()` calls now actually render. The CAS Import screen
  existed as a component but was never wired into dashboard navigation — fixed.
- ✅ Live: real end-to-end runs completed successfully against production (real
  PAN, real emails, real imports) multiple times 2026-08-24; ruff clean; full
  `uv run pytest` suite green (201 passed / 2 skipped) with new tests for the
  request module, the email-fetch module (incl. the stale-email regression), and
  the folios-shape parsing; dashboard typecheck/lint/build clean.

### M9 — Deployment (2–3 evenings)
- Migrate SQLite → Supabase (schema ports 1:1) — the shared spine: local legs and cloud
  legs write the SAME store (SQLite's single-writer rule forbids two hosts).
- **Host constraint (user, 2026-08-07: "cannot keep the laptop on forever").** The
  always-on-Windows-box assumption is dropped. Three options, all deployable:
  - **A. Cheap/free VPS (recommended):** a small Linux VM (Oracle Cloud Always Free tier
    = ₹0, else ~₹150–250/mo) runs the Zerodha daemon + the scheduled broker-leg jobs.
    The daily 2FA becomes "daemon sends you the login link via Telegram; you approve on
    your phone" — no browser on the server. Moomoo OpenD on a headless box is the awkward
    bit (needs a virtual desktop) — see C.
  - **B. Old always-on device at home (₹0, simplest for Moomoo):** a retired laptop /
    NUC / mini-PC with a desktop runs BOTH broker legs exactly as today (Task Scheduler
    on it); the cloud handles the rest.
  - **C. Stale-tolerant laptop-only (₹0):** broker legs run only while the laptop is on
    (manual `--force` or on-wake catch-up); the staleness monitor nags when live prices
    go stale. Charts/history/NAV/FX stay current regardless (cloud legs).
- **The split (§3 resolution #2):**
  - **Stays on an always-on broker-leg host (Option A or B):** the Zerodha daemon + its
    daily 2FA (the link-click is the only human step) and the Moomoo OpenD leg (desktop
    app — see the OpenD caveat). Only the human's 2FA can never move.
  - **Moves to GitHub Actions cron (free):** CAS email fetch (Gmail OAuth) + import,
    AMFI NAV refresh, FX refresh, alert evaluation → Telegram, dashboard export.
    Secrets in Actions env (Gmail refresh token, Telegram, Supabase service key).
- Dashboard → Vercel/Netlify reading Supabase; agent on-demand (serverless or local).
- Staleness monitor: Telegram if today's EOD run is missing; CI grep-guard failing on
  accidental token/secret patterns.
- **Cost: ₹0 on the cloud side** — GH Actions + Vercel free tiers; no paid API
  dependencies (Groww CAS and AMFI NAV are free by design, §2c); Option A adds
  ₹0–250/mo, B and C are ₹0.
- ✅ Done when: hosted dashboard shows live data; a deliberately-skipped broker-leg run
  triggers the staleness alert.

---

## 6. Cross-cutting guardrails (enforced in code, not just policy)

- **Two-layer tool allowlist:** broker MCP clients expose only whitelisted tool names
  (e.g. `get_holdings`, never `place_order`); on the agent side, opencode `tools` config
  + per-agent overrides disable everything outside the read-only allowlist (§2b).
  Order place/modify/cancel tools are never referenced anywhere. For self-hosted Kite MCP
  use `EXCLUDED_TOOLS`; the hosted instance already excludes destructive tools. Our
   Groww CAS import never registers write tools at all.
- **Secrets:** tokens only in gitignored `data/tokens.json`; redaction filter on all
  logging; snapshots contain holdings, never credentials; CI grep check.
- **Read-only scopes** requested wherever a platform allows configuring them; where it
  doesn't, the allowlist is the boundary.
- **Determinism boundary:** Phases 1–4 and 6 produce identical output for identical input;
  LLM touches only Phase 5 and the dashboard chat.
- **No automated login** against Zerodha's stated policy — daily manual
  browser login only (regulatory requirement, see §2).

## 7. Key risks

- Hosted MCP tool names/response shapes can drift → inspect-first step in every broker
  milestone; pin samples in `samples/` for regression comparison.
- Groww Trade API is equities-only (no MF) → **resolved via CAS import** (§2c); the
  residual risk is CAS PDF layout drift in `casparser` — pin real statements as
  regression fixtures (inspect-before-normalize).
- **Moomoo OpenD is a desktop app** → the Moomoo leg cannot move to pure-cloud cron
  cleanly; keep it on the local box (recommended) or run OpenD on an always-on VPS.
  The Zerodha daemon is pure Python and CAN live on a VPS — only the human's daily 2FA
  is immovable (§3 resolution #2).
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
