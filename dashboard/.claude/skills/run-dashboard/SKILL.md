---
name: run-dashboard
description: Build, run, and drive the portfolio dashboard (React + FastAPI bridge) using real exported data. Use when asked to start the dashboard, run the dev stack, take a screenshot of the UI, check bridge health, or interact with the running app in a browser.
---

The dashboard is two local dev processes (FastAPI bridge on :8001, Vite on :5173)
reading from real, already-exported JSON in `dashboard/public/data/`. Drive read-only
API state with `curl` against the bridge; drive the UI with the `claude-in-chrome`
MCP tools (`navigate` / `computer` / `read_console_messages`). No custom driver script
is needed — this app already has both handles.

All paths below are relative to `E:\agentic-portfolio-dashboard\` (the repo root, one
level above `dashboard/`), not the skill directory.

## Prerequisites

Already-set-up personal machine, not a fresh clone: `uv` manages `.venv` at repo root,
`npm`/node_modules already installed under `dashboard/`, and `data/` (SQLite db,
`data/tokens.json`, `dashboard/public/data/*.json`) already has real broker data from
past pipeline runs. Verify before assuming a fresh install is needed:

```bash
ls .venv/Lib/site-packages/fastapi 2>/dev/null && echo "venv ok"
ls dashboard/node_modules/.bin/vite 2>/dev/null && echo "deps ok"
```

If either is missing: `uv sync` (repo root) / `npm install` (in `dashboard/`).

## Run (agent path)

Two background processes, then drive them with `curl` (bridge) and `claude-in-chrome`
(UI). **Never click "Refresh" or hit `POST /api/refresh`, `/api/snapshot/{platform}`,
`/api/cas/*`, or `/api/live`** — those shell out to the real `portfolio` CLI against
live brokers (Zerodha needs daily manual 2FA) or the CAMS mailback form. Everything
below is read-only.

```bash
# 1. bridge (serves /api/* to the dashboard; also directly curl-able)
cd /e/agentic-portfolio-dashboard
(uv run python -m portfolio.bridge > /tmp/bridge.log 2>&1 &)
sleep 3 && tail -5 /tmp/bridge.log
# -> "Uvicorn running on http://127.0.0.1:8001"

# 2. vite dev server
cd dashboard
(npm run dev > /tmp/vite.log 2>&1 &)
sleep 4 && tail -5 /tmp/vite.log
# -> "Local: http://127.0.0.1:5173/"
```

Read-only bridge checks (no side effects):

```bash
curl -s http://127.0.0.1:8001/api/health       # pipeline export freshness + daemon reachability
curl -s http://127.0.0.1:8001/api/jobs/status  # last snapshot/import run per platform
```

Drive the UI with the `claude-in-chrome` MCP tools (load them first if deferred:
`ToolSearch("select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__read_console_messages")`):

```
navigate({ url: "http://127.0.0.1:5173" })
computer({ action: "screenshot", tabId: <id> })
computer({ action: "left_click", coordinate: [x, y], tabId: <id> })  # switch workspace tabs (Journey/Allocation/Portfolio/Alerts/Properties/Groww-Sharekhan Data)
```

The top nav tabs switch workspaces via in-memory state, not URL routing — you can't
deep-link to `/#alerts`, you have to click the tab.

Contract check against the live exported JSON (fast, no browser needed):

```bash
cd dashboard && npm run check:contract
# -> "ok   latest.json: ..." per file, "Contract check passed" at the end
```

## Run (human path)

`npm run dev:stack` (in `dashboard/`) starts bridge + vite + `opencode serve` together
via `concurrently` — same processes as above, one command, human-facing terminal
output. Ctrl-C to stop. Not meaningfully different for an agent; the two-process path
above gives cleaner separate logs.

## Test

```bash
cd dashboard && npm run typecheck   # tsc -b --noEmit
cd dashboard && npm run check:contract
uv run pytest                       # Python pipeline suite (repo root)
```

`npm run typecheck` had ~10 pre-existing errors as of 2026-09-08, all in
`src/components/segments/` and `src/components/ui/chart-legend.tsx` — unrelated to
bridge/dashboard wiring. `check:contract` passed clean against the live exports.

## Stopping

Both dev processes were started detached with `&`; find and kill by port:

```bash
netstat -ano | grep -E ":8001|:5173" | grep LISTENING
taskkill //PID <pid> //F
```

## Gotchas

- **The bridge does not hot-reload.** Editing `src/portfolio/bridge.py` while it's
  running has no effect until you kill and restart the `uv run python -m
  portfolio.bridge` process — confirmed by `CLAUDE.md`, matches the module docstring's
  warning.
- **Port 8000 is taken by another local project (Cardora)** — the bridge listens on
  8001, not 8000. Don't assume 8000.
- **`Refresh` / snapshot / CAS endpoints have real-world side effects** (shell out to
  broker MCPs, the CAMS mailback Playwright flow, or Zerodha's daemon) — verified by
  reading `bridge.py`'s endpoint list; deliberately not exercised in this skill. Stick
  to `GET /api/health` and `GET /api/jobs/status` for read-only verification.
- **Clicking a nav tab after taking a screenshot can land on the wrong tab** if the
  window/viewport reflows between the screenshot and the click (observed: aiming for
  "Portfolio" landed on "Alerts" once because the header's flex layout shifted). Take
  a fresh screenshot immediately before clicking a nav item, not from an earlier one.
