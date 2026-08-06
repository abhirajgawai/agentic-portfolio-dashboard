# Agentic Portfolio Dashboard

A personal, learning-first project that aggregates holdings across multiple brokers
(Zerodha, Groww, Moomoo) into one consolidated view — with an agentic Q&A layer on top.
Built phase by phase against a locked plan (`PLAN.md`); each phase is deterministic,
tested, and verified before the next starts.

> **Current status: M0 ✅ + M1 ✅** — scaffold + Zerodha end-to-end (live session daemon,
> snapshot pipeline, relational SQLite schema v2). M2 (Moomoo + consolidated) is next.

---

## What it does

| Phase | Builds | Status |
|---|---|---|
| M0 | uv project, SQLite schema v1, redacted logging, migrations | ✅ |
| M1 | Zerodha MCP client, daily-login session daemon, snapshot pipeline, schema v2 | ✅ |
| M2 | Moomoo MCP, FX (one rate/run), consolidated INR view | ⏳ next |
| M3 | Groww custom FastMCP wrapper, daily trade capture | ⏳ |
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
- **Zerodha** (IN) — hosted MCP server `https://mcp.kite.trade/mcp`
- **Groww** (IN) — official REST Trade API (`growwapi` SDK), wrapped in our own read-only FastMCP
- **Moomoo** (US) — hosted MCP `https://mcp.moomoo.com/mcp` (OAuth)

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
portfolio db migrate            apply pending SQL migrations (versioned)
portfolio serve --platform zerodha   hold the day's session, serve read-only RPC (:8787)
portfolio snapshot --platform <zerodha|moomoo|groww|all> [--eod]
```

---

## Database (schema v2)

SQLite at `data/portfolio.db` (gitignored). Two kinds of tables, by design:

**State — current picture, upserted in place (never grows):**
- `account` — one per broker account
- `instrument` — one row per (platform, ticker); the join key for everything
- `position` — current qty/avg cost/value per instrument

**History — the daily ledger, written only on `--eod` runs (~35 rows/day):**
- `position_snapshot` — per-holding EOD snapshot (FK to a `runs` row)
- `price_history` — daily close per instrument
- `portfolio_value` — total value by scope (all / geography / platform)

**Market + audit:**
- `fx_rate` — one rate per run (INR base; empty until M2)
- `trade` — daily trade capture for XIRR (M3)
- `runs` — every pipeline run: status, row counts, `is_eod`, `snapshot_date`

**Key constraints:** `position` is UNIQUE on `(platform, ticker)`; `price_history` is
UNIQUE on `(instrument_id, price_date)`; re-running a day updates instead of duplicating.

Migrations live in `src/portfolio/db/migrations/` (e.g. `0002_v2_relational.sql` migrates
v1 data into v2 and drops the old tables). `portfolio db migrate` applies pending ones
sequentially.

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
3. **No automated login** — Zerodha/Groww require daily manual 2FA (regulatory). The
   daemon detects expiry and surfaces it; nothing scripts the browser.
4. **Determinism boundary** — M0–M6 produce identical output for identical input.

---

## Repo layout

```
src/portfolio/
  cli.py            typer CLI (db / serve / snapshot)
  serve.py          session daemon: single task owns connect→login→serve→close
  snapshot.py       orchestrator: collect → normalize → write state (+ history on --eod)
  clients/          per-broker MCP client, each with its read-only ALLOWLIST
  normalize/        raw MCP output → common holding schema
  tokens/           token store + zerodha login helper (expiry detection)
  db/               schema.sql migrations, migrate.py, writer.py (upserts)
  config.py         env loading, platform registry
scripts/probe_mcp.py   inspect-first: list tools, dump raw outputs to samples/
samples/zerodha/        pinned MCP baselines (tool inventory, error shapes)
data/                   gitignored: portfolio.db, tokens.json, holidays/
tests/                  pytest — normalizers, migrations, writer, client allowlist
```

---

## Development

```sh
uv run ruff check .        # lint
uv run pytest              # 38 tests
```

Testing convention: raw MCP outputs are pinned in `samples/` *before* any normalizer is
written; normalizers and the migration backfill are tested against fixed fixtures.

---

*Learning-focused build. Full plan, decisions, and research findings: [`PLAN.md`](PLAN.md).*
