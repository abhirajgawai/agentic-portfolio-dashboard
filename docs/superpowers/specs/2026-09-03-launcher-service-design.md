# Launcher service + click-to-fix status indicators

## Context

The dashboard already surfaces backend health (FastAPI bridge reachability, agent
reachability, and — as of the previous change in this session — a live Zerodha
session-daemon probe) via `useBackendHealth` / `HealthTicker`. All of it is
read-only: if the bridge is down, the UI can only say so, not do anything about it,
because a dead HTTP server cannot respond to a click asking it to restart itself.

The user wants the UI to be actionable: clicking a broken-status indicator should
attempt to fix it (start the bridge, start the Zerodha daemon + open its 2FA login,
open Moomoo's OpenD gateway), the same way `run-all.ps1` already does when run by
hand. This requires a second, always-on process — the "launcher" — that exists
purely to spawn other local processes on request, since it needs to keep working
even when the bridge itself is the thing that's broken.

## Non-goals

- No auth token / secrets on the launcher — loopback-only (127.0.0.1), consistent
  with the bridge itself having none (single-user local tool, CLAUDE.md's existing
  threat model).
- No change to the guardrail against automated Zerodha login — the launcher starts
  the daemon process; the daily 2FA remains a manual browser step the user completes
  themselves, exactly as `ensure_zerodha_daemon()` already does today.
- The launcher does not touch the DB, brokers, or exports. It only spawns processes.

## Design

### `src/portfolio/launcher.py` — new tiny FastAPI app, port 8002

Chosen because it's the next free port after this project's existing 8787
(Zerodha daemon), 8001 (bridge), 8000 (Cardora, another local project), 4096
(opencode agent), 5173 (Vite dev).

Endpoints:

- `GET /health` → `{"ok": true}`. Always succeeds if the process is alive — no
  dependencies to fail.
- `POST /start/bridge` → checks whether `:8001` is already listening (a plain
  socket connect attempt, no HTTP call). If not, spawns
  `uv run python -m portfolio.bridge` detached (`DETACHED_PROCESS |
  CREATE_NEW_PROCESS_GROUP` on Windows, same pattern as
  `snapshot.py::_spawn_zerodha_daemon`), with stdout/stderr appended to
  `data/logs/bridge.log`. Returns `{"ok": true, "started": bool}` — `started=false`
  when it was already up (idempotent, safe to click twice).
- `POST /start/opend` → best-effort: checks a short list of common Windows OpenD
  install paths, plus a `PORTFOLIO_OPEND_PATH` env var override for when the
  install location doesn't match any default. If found, spawns it detached; if
  not, returns `{"ok": false, "error": "OpenD executable not found — open it
  manually, or set PORTFOLIO_OPEND_PATH"}` (422). No path to reliably auto-detect
  every install, so this degrades honestly rather than guessing wrong.
- No `/start/zerodha` — once the bridge is up, the existing
  `POST /api/snapshot/zerodha` bridge endpoint already calls
  `ensure_zerodha_daemon()`, which spawns the daemon and opens the Kite login
  browser for the user's manual 2FA. Duplicating that here would be redundant and
  risks the two spawn paths drifting apart.

### Startup: new dedicated Task Scheduler entry

`scripts/scheduler/register_launcher.ps1` (new, separate from
`register_tasks.ps1`, which the user deliberately emptied out this session in
favor of on-demand-only snapshots). This is a **deliberate exception** to that
on-demand policy: the launcher's entire purpose is to be alive when everything
else isn't, so it must run continuously, not on a calendar trigger. Registered to
start at user logon, `StartWhenAvailable`, restart-on-failure via the task's
own restart settings (a launcher crash should self-heal). Reversed by
`scripts/scheduler/unregister_launcher.ps1`.

### Frontend

- New hook `useLauncherHealth()` (`dashboard/src/lib/useLauncherHealth.ts`),
  polling `GET http://127.0.0.1:8002/health` independently of
  `useBackendHealth` (must work even when the bridge is fully down).
- `HealthTicker`'s existing "bridge down" pill becomes clickable when the
  launcher reports healthy: `onClick` → `POST :8002/start/bridge`, toast
  "Starting bridge…", the existing 10s health poll picks up recovery
  automatically. If the launcher is *also* unreachable, clicking instead shows
  the manual restart command (`uv run python -m portfolio.bridge`) — the honest
  final fallback when nothing is left to automate.
- The "zerodha down"/"2FA needed" pill's click behavior is unchanged from the
  prior session's plan: calls the existing `POST /api/snapshot/zerodha` (only
  shown/relevant when the bridge itself is up).
- `LiveJobsRow`: add an "Open OpenD" button next to the existing Moomoo retry
  button, calling `POST :8002/start/opend`; toast on success/failure.

## Data flow / error handling

- All launcher calls are fire-and-forget from the UI's perspective — the launcher
  returns quickly (spawns a detached process and returns, does not wait for the
  spawned process to become healthy). The existing health polls (bridge health
  every 10s, launcher health on its own interval) are what surface the actual
  recovery to the user; no new polling loop is needed inside the launcher itself.
- A `start/*` call while the target is already up is a no-op (`started: false`),
  so a user double-clicking a recovering indicator can't cause duplicate
  processes or port conflicts.
- The launcher never surfaces broker/DB errors (it doesn't touch them) — its only
  failure modes are "target already running" (handled) and "executable not
  found" (Moomoo case only, clearly reported).

## Testing

- Manual: kill the bridge process, confirm the footer pill goes to "bridge down"
  and becomes clickable once the launcher is separately confirmed running; click
  it; confirm the bridge process reappears and the pill recovers within ~10s.
- Manual: same for Moomoo/OpenD if a local OpenD install path is available to
  test against; otherwise verify the "not found" error path.
- `uv run ruff check src/portfolio/launcher.py` — must be clean.
- `npm run typecheck` / `npm run lint` on the new frontend hook + edited
  components.
