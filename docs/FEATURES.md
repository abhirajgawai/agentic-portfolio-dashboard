# Features — Milestones M0 through M6

Everything built so far (as of 2026-08-17). Source of truth: `PLAN.md` (the plan)
and the code itself — this file is the readable inventory. Every milestone passed
its independent review gate (code-reviewer verdict APPROVE) before advancing.

| Milestone | Status | Gate |
|---|---|---|
| M0 Scaffold | ✅ DONE | — |
| M1 Zerodha end-to-end | ✅ DONE | — |
| M2 Moomoo + consolidated view | ✅ DONE 2026-08-07 | APPROVE |
| M3 Groww free CAS import + trade capture | ✅ DONE 2026-08-07 | APPROVE |
| M3.5 Hardening | ✅ DONE 2026-08-07 | APPROVE |
| M4 Scheduling + calendars | ✅ DONE 2026-08-07 | APPROVE |
| M5 Returns & XIRR | ✅ DONE 2026-08-17 | APPROVE |
| M6 Alerts (rule-based) | ✅ DONE 2026-08-17 | APPROVE |
| M7 Q&A agent · M8 Dashboard · M9 Deploy | ⏳ pending | — |

---

## M0 — Scaffold (the foundation)

- **uv-managed Python project** — `pyproject.toml` (ruff, pytest, dev group), venv in
  repo, deterministic `uv run` everywhere.
- **`portfolio` CLI** (typer) — `src/portfolio/cli.py`; every feature below is exposed
  as a command (`db migrate`, `serve`, `snapshot`, `trades`, `cas import`, `nav
  refresh`, `fx refresh`, `returns`, `alerts`, `auth`).
- **SQLite with versioned migrations** — `src/portfolio/db/migrate.py` +
  `migrations/0001..0006.sql` (schema v6). `portfolio db migrate` is idempotent and
  reconciles stale `running` rows to `error`.
- **Secret-redaction logging filter** — `src/portfolio/logging.py`; tokens/credentials
  can never appear in logs (guardrail #2; observed live: DB path masked in logs).
- **Config + platform registry** — `src/portfolio/config.py`: env loading
  (`BASE_CURRENCY`, `FX_SOURCE`, `TELEGRAM_*`, `PORTFOLIO_DB_PATH`), `PLATFORMS`
  map (geography / settlement currency / display currency), `DATA_DIR`/`HOLIDAYS_DIR`.
- **`.gitignore` discipline** — `data/tokens.json`, `data/*.db*`, `data/logs/`,
  `dashboard/public/data/` all excluded from git.

## M1 — Zerodha end-to-end

- **MCP client → hosted Kite MCP** — `src/portfolio/clients/zerodha.py` (streamable
  HTTP), with a **read-only tool allowlist** (`get_holdings`, `get_quotes`, …; order
  place/modify/cancel tools are never referenced — guardrail #1).
- **Session daemon** — `portfolio serve --platform zerodha`
  (`src/portfolio/serve.py`): holds the day's authenticated Kite connection on
  loopback RPC `127.0.0.1:8787` (`/health`, `/rpc`), spawned/managed by
  `src/portfolio/snapshot.py` (`ensure_zerodha_daemon`).
- **Daily manual 2FA login flow** — `src/portfolio/tokens/zerodha_login.py`: the MCP
  `login` tool generates the auth URL → browser → user approves → daemon verifies with
  `get_profile`. **Never automated** (guardrail #3 — regulatory).
- **Zerodha normalizer** — `src/portfolio/normalize/zerodha.py` → common holding
  schema (ticker, name, qty, avg price, cost basis, current price, values, currency,
  sector, asset class, ISIN, exchange, day P&L…).
- **`portfolio snapshot --platform zerodha`** — collect → normalize → FX → persist.
- **Expired-session detection → Telegram warning** — `_session_expired` +
  `send_snapshot_expiry_warning` (never a silent failure).
- **Smart write pattern** — `position` (live state, upserted in place, table never
  grows) vs `position_snapshot` + `price_history` (daily ledger, written on EOD runs)
  vs `runs` (one audit row per attempt).

## M2 — Moomoo + consolidated view

- **Spike → design decision (2026-08-06):** the hosted Moomoo MCP only grants
  `quote:read` to dynamic clients (3 consents tested; account tools 401), so holdings
  come from the **OpenD gateway** + official `moomoo-api` SDK, wrapped in our own
  **read-only FastMCP server** (`moomoo_mcp/server.py`): tools `get_accounts`,
  `get_positions`, `get_funds` — **order tools are never registered**.
- **Trade password from the gitignored token store** — `data/tokens.json` at startup
  (`unlock_trade`); never exposed as a tool argument; `portfolio auth --platform
  moomoo` sets it up (checks OpenD reachable on `127.0.0.1:11111`).
- **US normalizer** — `src/portfolio/normalize/moomoo.py` (Futu `PositionInfo` field
  names: `code`/`qty`/`cost_price`/`nominal_price`/`market_val`), verified live.
- **FX module** — `src/portfolio/fx.py`: **one rate per run** (process-wide cache =
  one HTTP fetch), keyless `open.er-api.com`, persisted to `fx_rates` with
  `UNIQUE(rate_date, base, quote, source)`; first writer wins (one rate per day).
- **Consolidated allocation in INR base** — `src/portfolio/normalize/allocation.py`:
  geography / platform / sector / asset class each **sum to 100%**.
- **Full-fidelity holdings (schema v4)** — day P&L / total P&L / prev close / ISIN /
  exchange / raw payload (`raw_json`) / `account_funds` / daily trade capture.
- **`portfolio snapshot --all`** — every leg in one run, one consolidated total +
  allocation.

## M3 — Groww via free CAS import + trade capture

- **`portfolio cas import`** — `src/portfolio/cas_import.py`: `casparser` parses the
  monthly Consolidated Account Statement (free, SEBI-mandated, covers CDSL/NSDL demat
  + CAMS/KFintech folios) → common schema (`platform=groww/sharekhan`,
  `asset_class=mutual_fund` for MFs); CAS transactions → `trades` for XIRR. Verified
  against the real June 2026 statement (27 holdings; ₹66.06L across 68 positions).
- **`portfolio nav refresh`** — `src/portfolio/mf_nav.py`: official AMFI `NAVAll.txt`
  (keyless, one fetch per run) reprices every CAS-derived MF **and ETF** daily;
  un-audited `=`-prefixed NAVs handled; ledger rows dated with the NAV's own date;
  CAS equities counted as `not_in_amfi` (never touched, never fabricated).
- **Daily trade capture** — `src/portfolio/trades.py`: zerodha `get_trades` (same-day
  only — must capture daily) + moomoo `get_fills`; dedupe `UNIQUE(account_id,
  external_id)` with `ON CONFLICT DO NOTHING` → idempotent re-runs ("0 new (N seen)").
- **Account funds capture** — `get_margins`/`get_funds` → `account_funds`
  (best-effort, never fails the run).

## M3.5 — Hardening (2026-08-07 review)

- **Every leg failure audited** — normalize/persist/session errors → `runs` error row
  + clean `SessionNotReady`; `--all` continues past a failed leg; CLI has a
  generic-except belt (clean message + exit 1, never a raw traceback in a job log).
- **Value series derived, not stored** — `src/portfolio/series.py` derives per-date
  per-scope values from `position_snapshot` → `history.json`; regression test asserts
  `all == Σ platforms == Σ geographies` for mixed-frequency days.
- **Per-platform freshness in the JSON contract** — `asOf` = MAX over `status='ok'`
  runs; per-holding `asOf`; per-platform `stale` flags (brokers 2d, CAS 35d).
- **Shared write path** — `src/portfolio/db/persist.py` (snapshot / CAS / NAV all
  persist through it); `session_id` stripped from logs; FX from one rate_date;
  stale-`running` sweep at migrate; `ensure_fx_rate` ON CONFLICT.

## M4 — Scheduling + calendars

- **Committed holiday lists** — `data/holidays/nse_2026.json` (16 closures incl. the
  Maharashtra municipal-election day) + `nyse_2026.json` (10 incl. observed 07-03 for
  Jul 4), cross-checked against broker-published official lists (sources in the files).
  **Year-rolling:** the gate picks the file by the date's year (`nse_{year}.json`), so
  2027 = dropping in two JSON files, no code edit; a missing year file degrades to
  weekday-only with a warning naming it.
- **`calendars.py` — pure, deterministic gate** — `is_trading_day` / `market_open` /
  `reason_closed` / `gate_check(geography, dt, *, is_eod)`: NSE 09:15–15:30
  `Asia/Kolkata`, NYSE 09:30–16:00 `America/New_York`; **zoneinfo only (DST-proof,
  pinned by tests)**; open-inclusive / close-exclusive; naive datetimes refused; every
  function takes `dt` (never reads a clock); lazy holiday cache.
- **Gate policy** — weekend/holiday blocks live AND EOD; trading-day EOD passes at any
  time; live polls only inside [open, close).
- **Gate wiring everywhere** — the gate fires **before any daemon spawn or broker
  call**; a skip writes an audited `runs` row (`status='skipped'`,
  `error='skipped: <reason>'`) and **exits 0** (a holiday is a normal no-op);
  `--force` bypasses for manual runs; `writer.write_skipped` is the one canonical
  skip-row helper.
- **`portfolio fx refresh`** — the 21:35 keyless leg (ungated — FX is global), one
  `get_fx_rates` call, `platform='fx'` run audit, idempotent.
- **`serve --gate`** — the 09:35 daemon start exits 0 quietly on non-IN-trading days
  (no daemon, no pointless 2FA prompt); manual/`--force` spawns stay ungated.
- **7 Windows Task Scheduler jobs** — `scripts/scheduler/`: 09:35 `serve --gate`, 09:45
  `snapshot --all` (live), 15:45 `snapshot --all --eod`, 15:50 `trades`, 15:55
  `export_json.py`, 21:30 `nav refresh`, 21:35 `fx refresh`. Venv-python wrappers
  (CWD-independent, no `uv run`, no `--force`), per-job logs in gitignored
  `data/logs/`, `register_tasks.ps1` / `unregister_tasks.ps1` / `list_tasks.ps1`
  (idempotent, current-user interactive, paths verified).
- **Full run-audit lifecycles** — snapshot legs, trades, nav and fx all write
  `running → ok/error` rows; a trades failure exits 1 (visible in `runs`, never a
  silent exit 0).

## M5 — Returns & XIRR

- **`src/portfolio/returns.py`** — pure/read-only:
  - `per_holding_return` / `portfolio_simple_return` — `(value − cost)/cost`; NULL/zero
    cost (M3's value-only CAS rows) → `None`, never a crash.
  - `series_change_pct` — trailing 1/7/30-day change from the derived series, honest
    with mixed-frequency gaps (picks the newest point inside the window).
  - **XIRR solver** — `Σ cfᵢ/(1+r)^(tᵢ/365) = 0` via **bisection on log-space**
    (`x = log(1+r)`, handles r→−1 and huge r) + **Newton polish**; the NPV is rewritten
    to be overflow-safe (`exp(x·(d_max−t)/365)` × positive factor), exp-clamped,
    precision 1e-9 → 4dp output, strict iteration caps; **no new dependencies**.
  - Cash-flow convention: `trade.amount_ccy` is stored SIGNED (+buy/−sell) → flow is
    `−amount_ccy` (buy = outflow, sell = inflow), pinned end-to-end against the
    trades.py writers.
  - `account_xirrs(conn, today)` — per **(account, FLOW currency)** (zerodha INR,
    moomoo USD): trade rows + terminal = Σ current position value dated `today` (never
    before the last trade). **Cross-currency XIRR is out of scope** — flows never
    converted (no historical FX for backfilled trades).
- **`portfolio returns` CLI** — read-only verification tool (not scheduled).
- **`dashboard/public/data/xirr.json`** — `{asOf, perAccount: {"<platform>__<ref|id>":
  {currency, xirrPct|null, terminalValue, flowCount}}, estimated: false}`.
- **Fixture-verified** — 10% one-year exact; 20.94% 183-day hand-computed case (the
  brief's 21.74% placeholder was wrong — the test pins the truth); degenerate→None
  suite incl. garbage dates.

## M6 — Alerts (rule-based, no AI)

- **`data/rules.yaml`** — committed, **structured data, zero eval/exec**: rules map to
  a fixed metric catalog computed by the engine — `total_value_base`, `day_pnl_pct`
  (day P&L → base via the same-rate_date FX contract, never fabricated),
  `simple_return_pct`, `platform_stale` (days PAST the platform's own threshold —
  brokers 2d, CAS 35d), `holding_return_pct` (cost-bearing holdings only; value-only
  rows skipped). Ops `lt|le|gt|ge`, severities info/warn/critical, optional `target`
  to pin one item. Shipped rules: portfolio day drop < −5% (warn), any holding
  < −25% from cost (warn), platform stale ≥ 2d past threshold (info).
- **`src/portfolio/alerts/engine.py`** — `load_rules` (lazy; missing/unparseable → []
  + warning), `evaluate` (pure, naive datetimes refused, deterministic), 
  `dedupe_and_send` (`UNIQUE(rule_id, event_date)` + ON CONFLICT DO NOTHING → one
  alert per (rule, Kolkata day), **one batched Telegram message per run** via the M1
  `send_telegram`, delivery failure logged and recorded anyway), `kolkata_date()`
  (the ledger's Asia/Kolkata date — never UTC), same-rate_date FX pairing.
- **Migration 0006** — `alert_events` table (dedupe backbone).
- **Wiring** — evaluated in `scripts/export_json.py` after xirr.json (failure-tolerant;
  latest/history/xirr unchanged) → `dashboard/public/data/alerts.json`
  `{generatedAt, alerts: [{ruleId, severity, message}]}`; `portfolio alerts` CLI with
  `--dry-run` (prints would-be alerts, sends/writes nothing).
- **Live proof** — real-DB dry-run fires 2 genuine rules (KPITTECH −45.74%,
  moomoo stale 8.00d); two export runs → exactly 2 `alert_events` rows (dedupe
  proven). Telegram delivery is the graceful-drop path until the token env vars are
  set (the "notifies" leg is pinned by tests with a mock).

---

## Cross-cutting (every milestone)

- **All five guardrails enforced in code** (never loosened):
  1. Two-layer read-only tool allowlist (broker clients + opencode `tools` config);
     order place/modify/cancel tools never referenced.
  2. Secrets only in gitignored `data/tokens.json` + mandatory redaction filter;
     snapshots/outputs contain holdings, never credentials.
  3. No automated login (Zerodha daily 2FA is manual by design; expiry → Telegram).
  4. Determinism boundary: M0–M6 produce identical output for identical input; no
     LLM anywhere in this path.
  5. Inspect-before-normalize: raw MCP outputs captured to `samples/` before any
     normalizer.
- **Testing discipline** — 138 passed / 2 skipped, ruff clean. Tests written only
  where they guard fragile seams: XIRR math, gate boundaries + DST, dedupe,
  fire-once semantics, sign conventions, UNIQUE-key invariants.
- **Docs** — `PLAN.md` maintained as the living source of truth;
  `docs/APPLICATION_FLOW.md` (flowchart, Mermaid + ASCII); this file.

## What this buys you

A machine that, every trading day hands-free: captures both broker portfolios
(35 zerodha + 6 moomoo holdings, live-verified 2026-08-17), converts to one ₹ view,
freezes the daily ledger, captures trades, reprices CAS MFs/ETFs, computes
returns/XIRR, evaluates alert rules, and exports everything the M8 dashboard will
render — every step gated by the market calendar and every outcome (ok / skipped /
error) visible in the `runs` audit trail.

## Next

M7 — Q&A agent (read-only `portfolio_data_mcp` + opencode config with tool allowlist
+ SSE client with turn budgets + eval set) → M8 — Dashboard → M9 — Deploy (Supabase,
GitHub Actions cron, Vercel, staleness monitor; host options A/B/C for the
no-always-on-laptop constraint).
