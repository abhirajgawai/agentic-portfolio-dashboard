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
- **Task Scheduler (all 7 registered + verified `Ready` on the always-on box, machine
  local = IST; scripts in `scripts/scheduler/`, reversal via `unregister_tasks.ps1`):**

  | Time (IST) | Task | Command | Manual? |
  |---|---|---|---|
  | 09:35 | `PortfolioServeZerodha` | `portfolio serve --platform zerodha --gate` (daemon up, waits for the 2FA login; no-op on non-trading days) | ✅ ~1 min/day |
  | 09:45 | `PortfolioSnapshotMorning` | `portfolio snapshot --all` | — |
  | 15:45 | `PortfolioSnapshotEod` | `portfolio snapshot --all --eod` | — |
  | 15:50 | `PortfolioTrades` | `portfolio trades` | — |
  | 15:55 | `PortfolioExportJson` | `scripts/export_json.py` → dashboard JSON | — |
  | 21:30 | `PortfolioNavRefresh` | `portfolio nav refresh` | — |
  | 21:35 | `PortfolioFxRefresh` | `portfolio fx refresh` | — |

  Wrappers call the venv python directly (`%ROOT%\.venv\Scripts\python.exe -m
  portfolio.cli ...`, CWD-independent, no `uv run` in scheduled tasks), append to
  gitignored `data/logs/<job>.log`, and carry NO `--force` — the pipeline's own gate
  handles holidays/weekends, so tasks fire daily and no-op on closed days.
- **Known limits (documented, acceptable):** the 09:45 live `--all` skips moomoo
  ("before open (09:30 EDT)") — the US leg is captured at the 15:45 EOD run; the 15:50
  trades task captures US fills only up to ~06:20 ET (later fills land on the next run
  with their own `trade_date` — XIRR dates stay correct, one day of lag); NYSE
  early-close days (e.g. Black Friday 13:00 ET) count as full days — irrelevant to an
  all-IST schedule; `fx refresh` prints the fetched rate even when a morning snapshot
  already stored the day's rate (first writer wins — one rate per day preserved).
- ✅ Done when: one week runs unattended; holidays/weekends skipped and logged; failures
  visible in `runs`. **Verification:** ruff clean; `uv run pytest` 114 passed / 2
  skipped (15 calendar + 10 gate tests); gate probe exact (`gate_check('IN',
  2026-01-26 10:00 IST)` → `holiday: Republic Day`); real `fx refresh` landed an `ok`
  `runs` row + day's rates live; 7 tasks registered + paths resolve
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
