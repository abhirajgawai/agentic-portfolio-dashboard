---
name: deployment
description: M9 deployment — Supabase migration of the SQLite schema, GitHub Actions cron snapshot, Vercel hosting for dashboard + APIs, secrets, and the staleness monitor. Use for M9.
---

# Deployment Skill (M9)

## 1. Supabase migration
- Port the SQLite schema (§4) to Postgres in `db/migrations/`.
- Migration runner keeps local SQLite as source of truth during transition; run
  parity checks (row counts + checksums on snapshots, runs, trades) before and after.
- Supabase connection string in env (GH secret / Vercel env), never in the repo.

## 2. GitHub Actions cron (`.github/workflows/snapshot.yml`)
- Schedule for NYSE/IST market days (avoid weekends/holidays via pipeline calendar
  gate). Replaces Windows Task Scheduler.
- Steps: checkout → setup uv + python → install → `uv run pipeline snapshot --eod`
  → upload `data/exports/` artifacts.
- If real tokens are absent, the `SENTINEL` flag runs the job with fixture data only
  (no broker connections).

## 3. Vercel hosting
- `dashboard/` static build → Vercel.
- Two small services: `agent` (chat → `opencode serve` via the Python client) and
  `pipeline` (refresh/export → returns static JSON). Vercel serverless functions or a
  small Node/Python service; keep them thin and read-only.

## 4. Secrets
- Repo only holds config templates + a `.env.example`. Real values live in GH
  encrypted secrets, Vercel env, and local gitignored `data/tokens.json`.
- CI grep-guard fails if a token pattern appears in tracked files.

## 5. Staleness monitor
- Cron checks latest `snapshots.run_at`; if older than N days (config, e.g. 5), send
  Telegram alert. For Zerodha/Groww an expired session additionally triggers a
  "daily login needed" reminder via the `token-session` flow.

## Verification
- Migration parity passes; scheduled snapshot lands in Supabase; dashboard reachable;
  staleness alert fires on synthetic old snapshot; `SENTINEL` run leaves no trace of
  broker calls.