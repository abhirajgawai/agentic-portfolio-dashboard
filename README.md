# Agentic Portfolio Dashboard

A personal, learning-first project that aggregates holdings across multiple brokers
(Zerodha, Groww, Moomoo) into one consolidated view — with an agentic Q&A layer on top.
Built phase by phase against a locked plan (`PLAN.md`); each phase is deterministic,
tested, and verified before the next starts.

> **Current status: M0 ✅ · M1 ✅ · M2 ✅ · M3 ✅** (2026-08-07)
>
> - **M2** — Moomoo holdings come from the **OpenD gateway** via our own read-only FastMCP
>   wrapper (`moomoo_mcp/`); the hosted MCP grants only `quote:read` to dynamic OAuth
>   clients (spike finding). FX (one rate/run), the US normalizer, consolidated INR
>   allocation (sums to 100%), and full-fidelity holdings (day P&L, schema v4) are built
>   and verified live against the real account.
> - **M3** — the paid Groww Trade API leg was **removed** (docs confirmed equities-only —
>   no mutual funds, §2c of PLAN). Groww (stocks + MFs) now comes from the **free CAS
>   import**: `portfolio cas import <statement.pdf>` parses the monthly Consolidated
>   Account Statement with the MIT `casparser` library and was verified against the real
>   June 2026 statement (27 CAS holdings: 13 Groww demat MFs, 7 folio MFs with cost basis
>   → returns computable, 6 Sharekhan stocks, 1 Zerodha MF; Zerodha equities skipped —
>   live MCP). **CAS MF + ETF prices refresh DAILY** via `portfolio nav refresh`
>   (official AMFI `NAVAll.txt` feed, `mf_nav.py` — Indian ETFs are in the same
>   feed); CAS equities keep the statement price until the next monthly import.
> - **M4–M9 pending** — scheduling/calendars, returns/XIRR, alerts, Q&A agent, dashboard,
>   deployment (see the table below).

---

## What it does

| Phase | Builds | Status |
|---|---|---|
| M0 | uv project, SQLite schema v1, redacted logging, migrations | ✅ |
| M1 | Zerodha MCP client, daily-login session daemon, snapshot pipeline | ✅ |
| M2 | Moomoo via OpenD gateway, FX (one rate/run), consolidated INR view, full-fidelity holdings | ✅ |
| M3 | Groww via **free CAS import** + daily trade capture (paid Groww API leg **removed**) | ✅ 2026-08-07 |
| M4 | Holiday/market-hours calendars, Windows Task Scheduler | ⏳ |
| M5 | Returns, time series, XIRR | ⏳ |
| M6 | Rule-based alerts → Telegram | ⏳ |
| M7 | Q&A agent (opencode server) over read-only MCP tools | ⏳ |
| M8 | Vite + React + recharts dashboard, chat drawer | ⏳ |
| M9 | Supabase + GitHub Actions cron + Vercel deploy | ⏳ |

The pipeline (M0–M6) is **deterministic**: identical input → identical output. The LLM
touches only the M7 Q&A agent and the dashboard chat — never the money math.

---

## Architecture

```
[browser 2FA login] ──> session daemon (serve) ──> read-only RPC on 127.0.0.1
                             │
Task Scheduler ──> snapshot ─┤─> MCP client (allowlisted tools) ──> broker
                             └─> normalize ─> SQLite (state + history) ─> JSON export
```

Three brokers, three integration styles (the point of the project):
- **Zerodha** (IN) — hosted MCP server `https://mcp.kite.trade/mcp` (free)
- **Groww** (IN) — **free CAS import** (`portfolio cas import`): the SEBI-mandated
  Consolidated Account Statement, emailed monthly, parsed by the MIT `casparser`
  library; covers Groww demat MFs + folio MFs + any other demat holdings (e.g.
  Sharekhan). The ₹499/mo Trade API was evaluated and **removed** — it is
  equities-only and can never return mutual funds (see `PLAN.md` §2c). **CAS-derived
  MF + ETF prices refresh daily** via `portfolio nav refresh` — the official AMFI
  `NAVAll.txt` feed (`mf_nav.py`, one keyless fetch per run; Indian ETFs are open-ended
  schemes in the same feed); CAS **equities** have no AMFI NAV and keep the statement
  price until the next monthly import.
- **Moomoo** (US) — **OpenD gateway** (local desktop app holding the login) + official `moomoo-api`
  SDK, wrapped in our own read-only FastMCP (`moomoo_mcp/`). The hosted MCP
  `https://mcp.moomoo.com/mcp` was spike-tested and is **market-data only**: its OAuth token
  endpoint grants just `quote:read` to dynamic clients, so account tools 401 (see `PLAN.md` §2b).

---

## Quick start

```sh
# 1. Install dependencies (uv manages a project-local venv)
uv sync

# 2. Create the database (runs all pending migrations)
uv run portfolio db migrate

# 3. Start the Zerodha session daemon, then complete the browser 2FA login
uv run portfolio serve --platform zerodha
#   → prints an mcp.kite.trade/authorize link; open it, log in, allow.

# 4. Snapshot holdings (poll: updates positions in place)
uv run portfolio snapshot --platform zerodha

# 5. End-of-day run (writes the daily history ledger)
uv run portfolio snapshot --platform zerodha --eod
```

### Why a session daemon?

Zerodha's hosted MCP does **not** persist a login across connections — each connection
mints a fresh session id, and the access token lives in-memory for ~12h (regulatory rule:
tokens expire at 6 AM, manual 2FA login is required daily). The daemon holds ONE
authenticated connection for the trading day and serves it to snapshot runs via a
loopback RPC, so scheduled runs never re-authenticate. See `PLAN.md` §2 for the full
research trail.

---

## Commands

```
portfolio db migrate                  apply pending SQL migrations (versioned)
portfolio serve --platform zerodha    hold the day's session, serve read-only RPC (:8787)
portfolio auth --platform moomoo      verify OpenD, store trade password, test read access
portfolio snapshot --platform <zerodha|moomoo|all> [--eod]
portfolio trades [--platform zerodha|moomoo|all]    daily trade + funds capture (XIRR input)
portfolio cas import <file.pdf>       parse a CAS statement -> holdings + ledger (Groww/IN)
portfolio nav refresh                 refresh MF prices from AMFI NAVAll.txt (daily, keyless)
```

### Groww via CAS (monthly, free)

Groww has no MF-capable API, so holdings come from the **Consolidated Account
Statement** — SEBI-mandated, emailed monthly, covering CDSL/NSDL demat + every MF
folio:

```sh
# Drop the month's CAS PDF anywhere, then:
uv run portfolio cas import data/cas/CAS-June2026.pdf
#   statement=2026-06-30 | groww=20 | sharekhan=6 | zerodha=1 | returns_ok=7 | value_only=20
```

What lands in the DB (same tables the live legs use): Groww demat MFs + folio MFs +
any other demat holdings, with `position_snapshot`/`price_history` stamped at the
statement date. **Known limit:** the CAS carries no cost basis for demat MFs and
equities, so those rows are *value-only* (`returns_ok` counts only the rows with a
cost basis — the folio MFs); the UI renders "—" for their return%. Zerodha equities
are skipped automatically (the live MCP leg already captures them — no double count).

```sh
# Between monthly statements, refresh CAS MF + ETF prices daily (free, keyless, one AMFI fetch):
uv run portfolio nav refresh
#   nav refresh: refreshed=21 | not_in_amfi=6   (the 6 Sharekhan equities stay at statement price)
```

### Moomoo setup (one-time, OpenD gateway)

Moomoo's hosted MCP only grants market-data scopes to OAuth clients (spike finding), so
holdings come from the **OpenD** desktop gateway — the app holds your Moomoo login the way
the Zerodha daemon holds the Kite session:

```sh
# 1. Install + open OpenD, log in with your Moomoo account
#    (https://www.moomoo.com/download/opend) — it listens on 127.0.0.1:11111.
# 2. Store the trade password (unlock_trade) + verify read access:
uv run portfolio auth --platform moomoo
# 3. Snapshot the US leg:
uv run portfolio snapshot --platform moomoo
# 4. Consolidated (INR base, allocation sums to 100%):
uv run portfolio snapshot --platform all
```

---

## Database (schema v5)

SQLite at `data/portfolio.db` (gitignored). Two kinds of tables, by design:

**State — current picture, upserted in place (never grows):**
- `account` — one per broker account; `base_currency` is the account's **display**
  currency (zerodha → INR, moomoo → SGD; the global consolidation base stays INR)
- `instrument` — one row per (platform, ticker); the join key for everything
- `position` — current qty/avg cost/value per instrument, plus `cost_value_base`
  (cost converted to INR at the run's fx rate, so return% is computable directly)
  and **full-fidelity day P&L detail** (`prev_close`, `day_change_ccy/pct`,
  `pnl_ccy/pct`, realized/unrealized P&L, `can_sell_qty`, `position_side`) and the
  broker's raw payload (`raw_json` — no field is ever lost)

**History — the daily ledger, written only on `--eod` runs (~35 rows/day):**
- `position_snapshot` — per-holding EOD snapshot (FK to a `runs` row), same day/P&L
  detail columns frozen daily
- `price_history` — daily close per instrument
- `portfolio_value` — total value by scope (all / geography / platform)
- `account_funds` — cash / assets per account per day (get_margins / get_funds)

**Market + audit:**
- `fx_rate` — one rate per run (INR base)
- `trade` — daily trade capture for XIRR (get_trades / get_fills), deduped by
  UNIQUE(account_id, external_id)
- `runs` — every pipeline run: status, row counts, `is_eod`, `snapshot_date`

**Key constraints:** `position` is UNIQUE on `(account_id, instrument_id)`; `price_history`
is UNIQUE on `(instrument_id, price_date)`; re-running a day updates instead of duplicating.

Migrations live in `src/portfolio/db/migrations/` and are applied sequentially:
`0001` v1 (legacy), `0002` v2 relational (migrates + drops v1), `0003` account display
currency + cost basis in base, `0004` full-fidelity holding detail + `account_funds`,
`0005` drops the dead `instrument.instrument_type` column.
`portfolio db migrate` applies pending ones (schema is at v5).

---

## Guardrails (enforced in code)

1. **Read-only tool allowlist** — broker MCP clients expose only whitelisted tools
   (`get_holdings`, `get_quotes`, …). Order place/modify/cancel tools are never
   referenced. The `login` tool is reachable only through the dedicated session helper,
   not the snapshot path.
2. **Secrets** — tokens live only in gitignored `data/tokens.json` and `.env`. A logging
   redaction filter scrubs secrets from every log line. Committed `samples/` are pinned
   baselines; anything captured against an authenticated session (`*_authed.json`) is
   excluded from git.
3. **No automated login** — Zerodha requires daily manual 2FA (regulatory). The
   daemon detects expiry and surfaces it; nothing scripts the browser. (Groww needs
   no login at all — its data comes from the emailed CAS + the keyless AMFI feed.)
4. **Determinism boundary** — M0–M6 produce identical output for identical input.

---

## Repo layout

```
src/portfolio/
  cli.py            typer CLI (db / serve / auth / snapshot / trades / cas)
  serve.py          session daemon: single task owns connect→login→serve→close
  snapshot.py       orchestrator: collect → normalize → write state (+ history on --eod)
  trades.py         daily trade + account-funds capture (XIRR input)
  cas_import.py     CAS statement → common schema (Groww/Sharekhan/MF holdings)
  mf_nav.py         AMFI NAVAll.txt: one fetch per run, {isin → nav/date/name}
  fx.py             one-rate-per-run FX (open.er-api.com, process-wide cache)
  clients/          per-broker MCP client, each with its read-only ALLOWLIST
  normalize/        raw MCP output → common holding schema (incl. allocation)
  tokens/           token store + zerodha login helper (expiry detection)
  db/               migrations, migrate.py, writer.py (upserts)
  config.py         env loading, platform registry (zerodha/groww/sharekhan/moomoo)
scripts/probe_mcp.py   inspect-first: list tools, dump raw outputs to samples/
scripts/export_json.py  emits the M8 latest.json contract from the DB
samples/zerodha/        pinned MCP baselines (tool inventory, error shapes)
samples/moomoo/         88-tool hosted-MCP inventory + spike diagnostics
samples/cas/            scrubbed CAS fixture (PII masked) for regression
samples/fx/             pinned open.er-api.com response (USD/SGD rates)
moomoo_mcp/             read-only FastMCP wrapper over the OpenD gateway
data/                   gitignored: portfolio.db, tokens.json, cas/, holidays/, logs/
tests/                  pytest — normalizers, migrations, writer, client allowlist
```

---

## Development

```sh
uv run ruff check .        # lint
uv run pytest              # full suite
```

Testing convention: raw MCP outputs are pinned in `samples/` *before* any normalizer is
written; normalizers and the migration backfill are tested against fixed fixtures.

---

*Learning-focused build. Full plan, decisions, and research findings: [`PLAN.md`](PLAN.md).*
