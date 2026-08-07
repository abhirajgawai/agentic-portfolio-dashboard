# Project Review — Agentic Portfolio Dashboard

**Date:** 2026-08-07
**Scope:** Full working-tree review (M0–M3 state: scaffold, Zerodha e2e, Moomoo/OpenD, Groww CAS import, trade capture, schema v4). Uncommitted M3 work included.
**Verdict:** **APPROVE WITH CHANGES** — architecture and guardrail enforcement are genuinely good; four MAJOR gaps must close before M4 (scheduling) and M8 (dashboard) can be honest.

---

## 1. Verdict summary

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| MAJOR | 4 |
| MINOR | 8 |
| NIT | 3 |

**The four MAJORs in one line each:**
1. **Daily AMFI NAV refresh is not wired** — `mf_nav.get_nav()` is dead code; Groww/Sharekhan prices in `position` go stale between monthly CAS imports while README/PLAN claim daily refresh.
2. **Broker payload shape drift aborts runs un-audited** — normalize failures raise *before* a `runs` row is written and kill the remaining legs in `snapshot --all` (PLAN's own #1 risk).
3. **`portfolio_value` scope rows clobber instead of sum** — proven in the live DB: on 2026-06-30 `all` == `groww` (₹18.9L) excluding Sharekhan + Zerodha MF; on 2026-08-07 `all` (₹38.3L) excludes the whole ₹19.3L CAS leg. The value chart is wrong by construction with mixed-frequency legs.
4. **`latest.json` presents mixed-freshness data under one `asOf`** — export's `asOf` is `MAX(runs.started_at)` while groww/sharekhan `position` rows are 5 weeks old.

---

## 2. Repo structure

```
agentic-portfolio-dashboard/
├─ PLAN.md, AGENTS.md, README.md        # plan (source of truth), conventions, user guide
├─ pyproject.toml, uv.lock              # uv-managed, Python ≥3.11, package "portfolio"
├─ .env.example                         # committed template; real .env gitignored
├─ .gitignore                           # tokens.json, *.db, data/cas/, *_authed.json samples
├─ .opencode/                           # agent topology (orchestrator + 7 subagents) + 10 skills
├─ src/portfolio/                       # the pipeline (deterministic M0–M6)
│  ├─ cli.py        [7.0 KB]  typer CLI: db migrate, serve, auth, trades, cas import, snapshot
│  ├─ config.py     [2.4 KB]  env accessor + PLATFORMS registry (geography/currency/display)
│  ├─ snapshot.py   [21.9 KB] run orchestration: legs, daemon lifecycle, persist, EOD ledger
│  ├─ serve.py      [5.0 KB]  Zerodha session daemon (loopback :8787, /health + /rpc)
│  ├─ cas_import.py [11.5 KB] CAS PDF -> common schema (Groww/IN stocks + MFs, monthly, free)
│  ├─ trades.py     [7.6 KB]  daily trade + account-funds capture (XIRR input)
│  ├─ mf_nav.py     [6.0 KB]  AMFI NAVAll.txt: one fetch per run, {isin: (nav, date)}
│  ├─ fx.py         [4.1 KB]  one rate per run, process-wide cache, persisted to fx_rate
│  ├─ logging.py    [4.2 KB]  mandatory secret-redaction filter (record level)
│  ├─ clients/      base.py, zerodha.py, moomoo.py   # MCP clients + read-only ALLOWLISTs
│  ├─ normalize/    schema.py, zerodha.py, moomoo.py, allocation.py
│  ├─ db/           migrate.py, writer.py, migrations/0001..0004
│  ├─ tokens/       store.py (tokens.json), zerodha_login.py, moomoo_oauth.py
│  └─ alerts/       telegram.py
├─ moomoo_mcp/server.py  [8.2 KB]  read-only FastMCP over the OpenD gateway (stdlib transport)
├─ portfolio_data_mcp/         EMPTY — M7 stub (read-only SQL tools for the agent)
├─ scripts/        export_json.py (M8 JSON contract), probe_mcp.py (inspect-before-normalize)
├─ tests/          16 test modules, ~5.4 KB of fixtures  (87 passed / 2 skipped)
├─ data/           gitignored: portfolio.db, tokens.json, logs/ ; committed: sectors.csv, holidays/
├─ samples/        committed raw MCP captures (redacted) — zerodha, moomoo/_tools.json,
│                  cas/cas_june2026_scrubbed.json, fx/er_api_inr.json
└─ dashboard/      EMPTY — M8 stub (public/data/ is where export_json writes)
```

**Python LOC:** ~5,370 across `src/`, `tests/`, `scripts/`, `moomoo_mcp/`.
**Layout verdict:** matches PLAN.md §4 closely, is right-sized (no micromodularity), lower layers (`normalize`, `db`, `fx`) are reusable without the upper layers. Two stubs (`portfolio_data_mcp/`, `dashboard/`) are honest placeholders for M7/M8, not dead code.

---

## 3. Design review

### 3.1 What the system is

A deterministic daily portfolio snapshotter: three brokers, three integration styles (deliberately, as a learning project):
- **Zerodha** — hosted MCP (`mcp.kite.trade`) behind a persistent **session daemon** (the hosted server does not resume sessions across connections — research-verified, PLAN §2). One manual browser 2FA login per day; daemon serves read-only RPC to scheduled runs.
- **Moomoo** — hosted MCP is market-data-only (OAuth grants `quote:read` only — 3-consent spike evidence), so holdings come from the **OpenD desktop gateway** via a local read-only FastMCP wrapper.
- **Groww** — the paid Trade API is equities-only (verified in official docs), so holdings come from the **free monthly CAS** parsed offline by `casparser`; NAV daily from AMFI.

All legs normalize to one `Holding` dataclass → SQLite (state/history split) → JSON export → (M8) React dashboard. M7 will add an opencode-agent chat layer; the LLM touches only that.

### 3.2 Architecture strengths (verified, not assumed)

- **State/history split is the right call.** `position` (one row per account+instrument, upserted in place — 100 polls leave one row, `test_snapshot.py:55`) vs `position_snapshot`/`price_history`/`portfolio_value` (deliberate daily ledger). This is the v1→v2 lesson, executed cleanly.
- **One-rate-per-run FX with a process-wide cache** (`fx.py`) — the correct answer to "two calls seconds apart return different rates and silently corrupt a run." Contract documented (`value_base = value_ccy * rate`, inverse of the er-api table).
- **Audit lineage**: `runs` rows parent every fact write; UNIQUE keys everywhere so retries can't duplicate (`writer.py` docstring contract).
- **Daemon lifecycle correctness**: `serve.py` keeps connect/serve/close inside one asyncio task because mcp's transport task groups must be exited by the task that entered them — a subtle anyio rule, correctly handled and documented.
- **The CAS import is well-engineered**: DP-id → platform attribution verified against the real June 2026 statement, Zerodha equities skipped to avoid double-counting with the live leg, cost-known vs value-only stats, idempotent month-over-month via UNIQUE keys.

### 3.3 Design weaknesses

- **Mixed-frequency legs and the "consolidated total"**: the design writes per-leg `portfolio_value` rows that *overwrite* the `(date, is_eod, scope_type, scope_key)` slot instead of summing (MAJOR-3, live evidence below). `snapshot --all` correctly defers writes and consolidates; `cas import` does not — the two paths disagree.
- **The monthly-CAS legs have no daily price source**: Groww MFs were supposed to refresh via AMFI NAV daily; the module exists, the wiring does not (MAJOR-1).
- **Freshness is not first-class**: `asOf` is a single timestamp over all platforms while data freshness differs by platform by up to 5 weeks (MAJOR-4).

---

## 4. Database structure (schema v4, `user_version=4`)

Live `PRAGMA table_info` dump from `data/portfolio.db` (all tables from migrations 0001–0004):

### Dimension tables (written once)

**`account`** — `id PK`, `platform NOT NULL`, `account_ref NOT NULL DEFAULT ''`, `label NOT NULL`, `base_currency NOT NULL DEFAULT 'INR'` · **UNIQUE(platform, account_ref)**
Live: 6 rows (zerodha '', moomoo ACC-…, groww <client_id>, groww 'folio', sharekhan <client_id>, zerodha CAS-MF account).

**`instrument`** — `id PK`, `platform`, `ticker NOT NULL`, `isin`, `name`, `instrument_type`, `geography`, `currency NOT NULL`, `sector`, `asset_class`, `created_at`, `exchange` · **UNIQUE(platform, ticker)**
Live: 61 rows. NOTE: `instrument_type` is **never written** by any code path (only `asset_class` is populated) — dead column.

### State (live, upserted in place)

**`position`** — `id PK`, `account_id`, `instrument_id`, `quantity NOT NULL`, `avg_cost`, `price NOT NULL`, `cost_value_ccy`, `market_value_ccy NOT NULL`, `market_value_base NOT NULL`, `updated_at NOT NULL`, + v3 `cost_value_base`, + v4 `prev_close`, `day_change_ccy`, `day_change_pct`, `pnl_ccy`, `pnl_pct`, `realized_pnl_ccy`, `unrealized_pnl_ccy`, `can_sell_qty`, `position_side`, `raw_json` · **UNIQUE(account_id, instrument_id)**
Live: **68 rows** = 35 zerodha + 6 moomoo + 27 CAS (13 groww demat MF + 7 folio MF + 6 sharekhan equity + 1 zerodha MF) — matches the M3 done-bar.

### History (daily/monthly ledger)

**`position_snapshot`** — v2 columns + v3 `cost_value_base` + v4 detail columns · **UNIQUE(snapshot_date, account_id, instrument_id)** — live: 103 rows.
**`price_history`** — `instrument_id`, `price_date`, `close`, `currency` · **UNIQUE(instrument_id, price_date)** — live: 96 rows.
**`portfolio_value`** — `value_date`, `is_eod`, `scope_type` (all|geography|platform), `scope_key`, `value_base` · **UNIQUE(value_date, is_eod, scope_type, scope_key)** — live: 14 rows.
**`account_funds`** — `account_id`, `snapshot_date`, `currency`, totals · **UNIQUE(account_id, snapshot_date, currency)** — live: 2 rows.

### Events / audit

**`trade`** — `run_id`, `account_id`, `instrument_id`, `trade_date`, `quantity` (SIGNED +buy/−sell), `price`, `amount_ccy`, `currency`, `external_id` · **UNIQUE(account_id, external_id)** — live: **0 rows** (capture runs are best-effort; cannot distinguish "no trades" from "capture always failing" — see §6.7).
**`runs`** — `platform`, `started_at`, `status`, `rows`, `error`, `snapshot_date`, `is_eod` · **UNIQUE(platform, started_at)** — live: 46 rows.

**`fx_rate`** — `rate_date`, `base`, `quote`, `source`, `rate`, `fetched_at` · **UNIQUE(rate_date, base, quote, source)** — live: 5 rows.

### Migration history

| Migration | Contents | Notes |
|---|---|---|
| 0001 v1 | wide `snapshots` table, `fx_rates`, `runs`, `trades` | kept verbatim for replay |
| 0002 v2 | state/history split + **guarded v1→v2 backfill** + DROP v1 tables | the important one; tested (`test_migrate.py:45`) |
| 0003 | `cost_value_base` on position/snapshot; moomoo account → SGD display | |
| 0004 | v4 detail columns, `raw_json`, `exchange`, `account_funds`, trade capture | |

Migration framework verdict: versioned, idempotent, `IF NOT EXISTS`-tolerant, `user_version` as source of truth — sound. Known limitation documented in 0002 (ALTER without IF NOT EXISTS needs manual recovery on mid-apply failure).

### Live-DB anomalies found (evidence for MAJOR findings)

1. **`portfolio_value` clobbering (MAJOR-3):**
   - `2026-06-30`: `scope all` = `platform groww` = **1,893,735.88** → Sharekhan (38,410.18) and the Zerodha MF (14,331.68) are **missing from the day's total**. The CAS import's per-batch `_persist(write_values=True)` upserts the same `(date, all, '')` slot with each batch's own sum; the last batch wins.
   - `2026-08-07`: `scope all` = **3,829,419.11** = zerodha (1,720,799.57) + moomoo (2,108,619.54) → the entire ₹19.3L groww leg is absent from the "total portfolio" for the day.
   - Consequence: the M8 trend chart fed by `portfolio_value` will dip/misstate totals whenever legs run on different days — which is the *designed* schedule (CAS monthly, brokers daily).
2. **Stale `running` row**: `runs` id 17 (zerodha, 2026-08-06T15:00) is stuck in `running` — a process died mid-run; no reconciliation ever flips it (MINOR-6).
3. **Legacy status string**: `runs` id 25 has `status='skipped_expired'` from an earlier code version; current code writes `'error'`, but the skills (`snapshot-pipeline/SKILL.md:15`, `token-session/SKILL.md:38`) still document `skipped_expired` — doc drift (NIT-3).
4. **`instrument_type` column is never populated** (NIT-1).
5. **Zerodha `account_funds` shows cash=0, buying_power=0** while Moomoo shows real funds — either genuinely zero (margins parse shape changed) or `_capture_zerodha_funds` is silently extracting the wrong key; worth one live look at `get_margins` during M4.

---

## 5. PLAN.md review

### 5.1 Milestone status vs. the `✅ Done when:` bars

| Milestone | Claimed | Verified? | Notes |
|---|---|---|---|
| M0 scaffold | ✅ | ✅ | schema + migrations + redaction test pass |
| M1 Zerodha e2e | ✅ | ✅ | daemon design implemented; expiry → Telegram + `runs` error row (live evidence: 3 error rows with "session expired") |
| M2 Moomoo + consolidated | ✅ | ✅ | OpenD wrapper, FX one-rate-per-run, allocation sums to 100% (tested), schema v4 |
| M2.5 full fidelity | ✅ | ✅ | day P&L / raw_json columns live in schema v4 |
| M3 Groww CAS + trades | ✅ | **partially** | import works & is verified against the real June 2026 CAS; but "NAV refresh daily via AMFI (`mf_nav.py`, one fetch per run)" is **not wired** — `get_nav()` has no caller outside tests (MAJOR-1) |
| M4–M9 | ⏳ | — | not started (calendars dir empty, dashboard/ empty) |

### 5.2 Locked decisions — all honored in code

- Python/uv/ruff/pytest ✅ · SQLite-first ✅ · Telegram alerts ✅ · base currency INR ✅
- Zerodha hosted MCP + session daemon ✅ · Moomoo OpenD fallback ✅ · Groww CAS (Trade API removed after docs check) ✅
- "Two kinds of work" deployment split is *designed for* but M9-pending ✅ (planning only)

### 5.3 Plan-vs-code drift

- **README.md:21 and PLAN M3 overstate the NAV refresh** ("enriches scheme names and refreshes prices daily") — only the name-enrichment half exists.
- Skills document a `skipped_expired` run status the current code doesn't emit.
- PLAN §4 repo layout shows `cas_import.py` at root; actual location is `src/portfolio/cas_import.py` (better — matches the layout's own `src/portfolio/` convention).
- `snapshot.py` docstring says "M2: Moomoo direct OAuth" — stale; the OpenD wrapper superseded it (cosmetic).

---

## 6. Guardrails audit (the non-negotiables — checked in code, not just docs)

| # | Guardrail | Evidence | Verdict |
|---|---|---|---|
| 1 | **Two-layer tool allowlist** | Layer 1: `clients/zerodha.py:23` `ALLOWLIST` frozenset + `call()` raises `PermissionError` off-list (`zerodha.py:121`, `moomoo.py:87`); `moomoo_mcp/server.py` registers only read tools; trade password never a tool argument. Layer 2: `.opencode/opencode.json` `tools` config disables `kite_place_order`/`modify`/`cancel`/`*gtt*` + moomoo globs. grep: order-tool names appear **only** in negative test assertions (`test_zerodha_client.py:11`, `test_moomoo_client.py:11`) | ✅ enforced |
| 2 | **Secrets only in `data/tokens.json`; redaction filter** | `git ls-files` → no tokens/db/env tracked; `samples/zerodha/login.json` shows `<REDACTED_AUTH_URL>`; `logging.py` redacts record-level combined message + literal token values from the store; `probe_mcp.py:122` scrubs before saving samples; `store.py` atomic write + 0600 | ✅ enforced |
| 3 | **No automated login** | `zerodha_login.py` opens browser, polls `get_profile`, raises on timeout → Telegram; no Selenium/TOTP anywhere (grep clean) | ✅ enforced |
| 4 | **Determinism boundary** | M0–M6 code has zero LLM imports; `normalize/` is pure; FX/NAV one-fetch-per-run with process caches; allocation keys sorted | ✅ enforced |
| 5 | **Inspect before normalize** | samples/ contains pre-normalizer raw captures (zerodha tools+holdings, moomoo 88-tool inventory, scrubbed CAS, er-api sample); probe_mcp.py is the tool | ✅ enforced — with a caveat: no scrubbed moomoo *positions* sample is pinned (only `_tools.json`); the normalizer tests fall back to a hand-built fixture (acceptable for private data, but the CAS-style scrubbed pin would be better) |

**Guardrail verdict: this is the strongest part of the project.** All five are enforced in code, not policy, and three are test-asserted.

---

## 7. Security pass

- **Secrets:** no hardcoded tokens; token store gitignored; redaction tested (JWT, bearer, base64, literal values). Login URL with `session_id` is printed to stdout and lands in the daemon log (`zerodha_login.py:63,66`) — local + gitignored, but the *logged* copy should be redacted (MINOR-1).
- **Network surface:** daemon `/rpc` binds 127.0.0.1 and only reaches the allowlisted read-only tools; unauthenticated but local-only (MINOR-8). OAuth callback server on 127.0.0.1:8788, 5-min window.
- **Input handling:** no SQL injection (parameterized everywhere), no shell=True, no eval/pickle/yaml.load (grep clean). `FX_SOURCE` is interpolated into a URL (`fx.py:50`) — env-controlled by the operator; low risk, worth a comment.
- **Supply chain:** `casparser` (parses untrusted PDFs — SEBI statements, but still: PDF parser) and the remote Kite MCP server are the real surfaces; both are shape-checked (`_extract_position_list`, `required_float`, `parse` payloads) and pinned-sample regression is the mitigation. `moomoo-api` and `casparser` are third-party but well-known; acceptable for personal use.
- **Dependencies:** `pyproject.toml` pins sensible minimums; no unmaintained junk.

---

## 8. Findings (severity-ranked, with fixes)

### MAJOR

**M-1 — AMFI daily NAV refresh is not wired; Groww/Sharekhan prices go stale.**
`src/portfolio/mf_nav.py:143` (`get_nav`) has no caller outside tests; `cas_import.py:250` uses the feed only for scheme *names*. After `cas import`, the 13 groww demat MFs + 7 folio MFs + 6 sharekhan equities sit at the statement-date price (06-30) in `position` — README.md:21 claims daily refresh. Impact: allocation sums and the XIRR terminal value silently drift; the dashboard shows 5-week-old prices as "today".
**Fix:** add `portfolio nav refresh`: `SELECT` groww/sharekhan MF ISINs from `instrument`, `get_nav(isin)` → upsert `position.price/market_value*/cost_value*` + a `price_history` row dated today, then re-export JSON. Wire into the M4 21:30 schedule (PLAN already puts it there). Correct README today.

**M-2 — Payload shape drift bypasses the `runs` audit and aborts `--all`.**
`snapshot.py:181` normalizes *before* `write_run` (line 183); `normalize/zerodha.py:52` `required_float` raises `ValueError` on a malformed row → no `runs` row, CLI traceback (`cli.py:186` catches only `SessionNotReady`). In `_snapshot_all` (`snapshot.py:89-98`) only `SessionNotReady` is caught, so one bad Zerodha row kills Moomoo too. PLAN §7 names shape drift as risk #1.
**Fix:** wrap normalize+persist per leg in `except Exception` → write a `runs` error row → re-raise as `SessionNotReady`; catch `Exception` per leg in `_snapshot_all` and continue.

**M-3 — `portfolio_value` per-leg writes clobber instead of sum (proven in live data).**
`cas_import` calls `_persist(write_values=True)` per batch (`cas_import.py:270-272`); `_portfolio_values` (`snapshot.py:393`) sums only *that batch's* holdings; the UNIQUE `(value_date, is_eod, scope_type, scope_key)` upsert means the last writer wins. Live proof: 06-30 `all` = `groww` = ₹18.9L (Sharekhan ₹38K + Zerodha MF ₹14K missing); 08-07 `all` = ₹38.3L (whole ₹19.3L CAS leg missing). `snapshot --all` does this correctly (`write_values=False` + one consolidated write) — the two paths disagree.
**Fix:** (a) minimal — CAS import: `write_values=False` per batch, then one consolidated write whose `all`/`geography`/`platform` sums come from the **current `position` table** (all platforms), not just the batch; (b) better — stop writing `portfolio_value` incrementally and derive the series at export time from `position_snapshot`, with explicit per-scope as-of handling.

**M-4 — `latest.json` presents mixed-freshness data under one `asOf`.**
`scripts/export_json.py:131` `asOf = MAX(runs.started_at)` over all runs; `position` rows for groww/sharekhan are as fresh as the last CAS import. The M8 "as of 15:45 IST" label will claim today for 5-week-old values.
**Fix:** emit per-platform (or per-holding) `asOf`/`stale` flags in the JSON contract now — the dashboard needs them regardless of M-1.

### MINOR

1. **Login URL with `session_id` printed + logged** — `tokens/zerodha_login.py:63,66`. Keep the console copy (user needs it), strip the query param (or add `session_id` to `logging.py` redaction labels) so the daemon log doesn't persist a login capability.
2. **Operator-precedence trap** — `normalize/moomoo.py:113` `exchange=item.get("position_market") or code.split(".")[0] if "." in code else None` parses as `(A or B) if C else D`; `position_market` is a market prefix ("US"), not an exchange. Parenthesize; use the real exchange field if the SDK has one.
3. **Cross-module private import** — `cas_import.py:241` `from portfolio.snapshot import _persist`. Move `_persist`/`_portfolio_values`/`_ensure_display_rates`/`_fx_for` into `db/writer.py` or a new `db/persist.py`; both callers import from there.
4. **`_load_sectors` doesn't skip `#` comments** — `snapshot.py:520-526`: `sectors.csv` comment lines become junk lookup entries. Skip lines starting with `#`.
5. **`export_json.load_fx` can mix rates from different dates** — `export_json.py:25-34` picks latest USD and latest SGD independently; a month-old SGD divided into today's USD distorts `usd_to_sgd`. Take both from the most recent run date that has both.
6. **Stale `running` rows never reconciled** — live `runs` id 17 stuck in `running` after a crash. Sweep `running` rows older than N hours to `error` at migrate/startup (cheap and keeps M4 failure visibility honest).
7. **`ensure_fx_rate` select-then-insert TOCTOU** — `db/writer.py:134-146`: use `INSERT … ON CONFLICT DO NOTHING` + re-SELECT (single-writer makes it theoretical today).
8. **`/rpc` unauthenticated** — `serve.py:75-110` loopback + read-only allowlist makes this acceptable for a personal box; add one comment documenting the trust model.
9. **`_snapshot_zerodha` `port` param ignored for trade capture** — `snapshot.py:195` → `trades.py:68` hardcodes `DEFAULT_PORT`. Thread the port through.

### NIT

1. `instrument.instrument_type` column is never written (only `asset_class`). Populate or drop.
2. `snapshot.py:162` `snapshot_date` uses machine-local timezone — pin `zoneinfo("Asia/Kolkata")` per the project's own convention so the ledger date is deterministic on any machine.
3. Skill/README drift: `skipped_expired` status documented but not emitted; `mf_nav` "daily refresh" claim; `normalize/moomoo.py:5` "pending final pinning" (no scrubbed moomoo positions pin exists — consider one, like the CAS scrub).

---

## 9. AI-slop check

- **Hallucinated APIs:** none — every import resolves; the `mcp`/`casparser`/`moomoo` SDK usage matches their real interfaces (verified by the passing suite + live runs).
- **Over-abstraction:** none. No factories/DI containers; `ToolResult`, `Holding`, `Allocation`, `LoginOutcome` are dataclasses that earn their place.
- **Zombie code:** `mf_nav.get_nav()` is the one real dead function (M-1). `moomoo_oauth.py` is documented as a market-data-only path — retained by design.
- **Fake robustness:** none — `except Exception` sites are deliberate, labeled (`# noqa: BLE001`), and either re-raise, log, or degrade with a Telegram warning. No bare `except: pass` anywhere.
- **Comment noise:** low. Comments explain *why* (session resumption, one-rate-per-run, UNIQUE-key rationale), which is what they should do.
- **Test spam:** none — tests assert behavior against pinned fixtures and mocked daemons; the two skips are honest.
- **Style whiplash:** none — one naming convention, consistent return types.

---

## 10. Test suite review

`uv run pytest -q -rs` → **87 passed, 2 skipped** (skips: real CAS PDF absent — gitignored; live moomoo sample absent — private). Highlights:
- Guardrail tests: allowlist rejections (`test_zerodha_client.py:35`, `test_moomoo_client.py:25`), redaction (6 cases, `test_redaction.py`).
- State/history invariant: 5 polls → 1 position row per holding (`test_snapshot.py:55`).
- Dedupe: EOD re-run same day doesn't duplicate (`test_snapshot.py:89`); trade re-run → "0 new trades" (`test_trades.py:57`).
- v1→v2 backfill data preservation (`test_migrate.py:45`).
- CAS against the **real scrubbed June 2026 statement** with exact fixture numbers (`test_cas_import.py:29-72`).
- Allocation sums to 100% per dimension (`test_snapshot_moomoo.py:175`).

Coverage gap worth naming: no test asserts the `portfolio_value` "all-scope-sums-all-platforms" invariant across mixed-frequency legs — which is exactly the bug M-3 found. That test should be the first one written with the M-3 fix.

---

## 11. Verification performed (this review)

| Check | Result |
|---|---|
| `uv run ruff check .` | ✅ pass |
| `uv run pytest -q -rs` | ✅ 87 passed, 2 skipped |
| `git ls-files` (secrets) | ✅ no tokens/db/.env tracked |
| grep place/modify/cancel | ✅ only negative test assertions |
| grep eval/pickle/yaml.load/shell=True/hardcoded offsets | ✅ none |
| `PRAGMA user_version` + full table dump | ✅ v4, 11 tables, live rows inspected |
| `samples/` redaction spot-check | ✅ auth URL scrubbed |

---

## 12. Better approach (if redesigning today)

Keep the architecture — it is sound. Close the four seams in order:
1. **Make the value ledger derived, not incremental.** `portfolio_value` written per leg per day is a sum-that-isn't. Either compute it once per day from the `position` table (all platforms, current prices) after all legs run, or derive it at export time from `position_snapshot`. This fixes M-3 permanently and removes the cross-leg ordering hazard.
2. **Wire the NAV refresh** (`mf_nav.get_nav` → `position`/`price_history` + JSON export) as a small standalone command in the M4 21:30 slot.
3. **Make every leg fail audited**: one shared `run_leg` wrapper that always writes a `runs` row (ok/error), catches shape drift, and never lets one leg abort the rest.
4. **Move `_persist` into the write layer** so snapshot, CAS import, and NAV refresh share one path instead of importing private functions.

---

## 13. What to do next (before M4/M8)

1. Fix M-3 (portfolio_value) + write the regression test that asserts `all == Σ platforms` for a mixed-frequency day.
2. Implement `portfolio nav refresh` (M-1) and correct README/PLAN claims.
3. Harden leg error handling (M-2).
4. Extend the JSON contract with per-platform `asOf` (M-4).
5. THEN start M4: calendars (`data/holidays/` is empty), market-hours gate with `zoneinfo`, Task Scheduler jobs, and the `runs`-visibility requirement (fix the stale-`running` sweep first).

---

## 14. Resolution log (added 2026-08-07, after the M3.5 hardening pass)

The 4 MAJORs above were fixed in the M3.5 hardening pass (see PLAN.md §M3.5), verified by the orchestrator, and re-reviewed in a gate pass (verdict: **APPROVE** for M4 — all prior findings closed; 8 new findings filed, of which 6 closed and 2 explicitly dispositioned below). Per-finding closure status:

| Finding | Status | Evidence |
|---|---|---|
| MAJOR M-1 (NAV refresh unwired) | ✅ FIXED | `portfolio nav refresh` live: `refreshed=21 \| not_in_amfi=6`; ledger rows dated with feed NAV date (08-06); idempotent re-run; live legs untouched by construction |
| MAJOR M-2 (shape drift un-audited) | ✅ FIXED | normalize/persist exceptions → `runs` error row → `SessionNotReady`; daemon-down/RPC-unreachable also audited (guard flag, no double-writes); `--all` continues past a failed leg; CLI generic-except belt; tests `test_malformed_holdings_row_writes_error_run_and_raises`, `test_all_continues_when_one_leg_fails`, `test_daemon_spawn_timeout_writes_runs_error` |
| MAJOR M-3 (portfolio_value clobber) | ✅ FIXED | `portfolio_value` writes removed entirely (table kept as legacy); `portfolio.series` derives the ledger from `position_snapshot` → `history.json`; `all == Σ platforms == Σ geographies` on 06-30 (2.78L), 08-06 (1.72L), 08-07 (6.64L); regression test `test_series_mixed_frequency_dates_are_honest` |
| MAJOR M-4 (one-`asOf` lie) | ✅ FIXED | `asOf` = MAX over `status='ok'` runs; per-holding `asOf`; per-platform `asOf`+`stale` (2d brokers / 35d CAS) in `latest.json` |
| MINOR 1 (login URL session_id logged) | ✅ FIXED | `session_id` stripped from logged copies (console keeps full URL on TTY); redaction label added |
| MINOR 2 (moomoo exchange precedence) | ✅ FIXED | parenthesized; SDK verified to have no exchange field — `position_market` kept as coarse value with comment |
| MINOR 3 (private `_persist` import) | ✅ FIXED | persist helpers → `src/portfolio/db/persist.py`; cas_import imports from db layer |
| MINOR 4 (sectors `#` skip) | ✅ FIXED | comment lines skipped |
| MINOR 5 (load_fx mixed dates) | ✅ FIXED | USD+SGD taken from one rate_date |
| MINOR 6 (stale `running` sweep) | ✅ FIXED | sweep at migrate; live run id 17 reconciled to `error` |
| MINOR 7 (ensure_fx_rate TOCTOU) | ✅ FIXED | `INSERT … ON CONFLICT DO NOTHING` + re-SELECT |
| MINOR 8 (`/rpc` trust model) | ✅ FIXED | trust-model comment added |
| MINOR 9 (port not threaded) | ✅ FIXED | `port` threaded through `capture_trades` |
| NIT 1 (`instrument_type` dead column) | ✅ FIXED | dropped via migration 0005 (schema v5) |
| NIT 2 (machine-local snapshot_date) | ✅ FIXED | `zoneinfo("Asia/Kolkata")` pinned in snapshot/trades/mf_nav |
| NIT 3 (skill/README drift) | ✅ FIXED | skills `skipped_expired` → `error`; README/PLAN NAV claims corrected |

**Gate-review follow-ups (8 new findings from the 2026-08-07 re-review):**

| Finding | Status | Notes |
|---|---|---|
| G1 `_snapshot_all` still wrote incomplete `portfolio_value` rows | ✅ FIXED | write path + `write_values` param + `portfolio_values()` removed; tests assert 0 rows |
| G2 NAV date vs ledger date mismatch | ✅ FIXED | ledger rows dated `min(nav_date, today)` — verified live (08-06 rows) |
| G3 daemon-down / RPC-unreachable un-audited | ✅ FIXED | `run_written` guard + `_audit_failure` in `_snapshot_zerodha`; moomoo symmetric |
| G4 `opencode.json` `"core-reviewer"` (nonexistent agent, array form) | ✅ FIXED | `default_agent: "orchestrator"` (string, primary agent) — restart opencode to load |
| G5 holder's real name in scrubbed CAS fixture | ✅ FIXED | 4× masked to `ABH*** ***`; grep-clean |
| G6 `nav refresh` CLI lacks generic-except belt | ✅ FIXED | same belt as `snapshot` |
| G7 error-path `rows=0` despite partial refresh | ➖ ACCEPTED | audit imprecision only; non-blocking for personal use |
| G8 `history.json` lacks `perHolding` (PLAN M8 contract member) | ⏭️ DEFERRED | deliberate: contract completes at M8 with the dashboard |

**Final state (verified 2026-08-07):** `uv run ruff check .` ✅ · `uv run pytest` 89 passed / 2 skipped ✅ · live `nav refresh` refreshed=21 | not_in_amfi=6, idempotent ✅ · `git ls-files` secret-free ✅ · order-tool grep clean (negative tests only) ✅. Remaining open items are G7 (accepted) and G8 (deferred) — both non-blocking for M4.
