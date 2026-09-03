# Launcher Service + Click-to-Fix Status Indicators — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small always-on "launcher" process that can spawn the bridge (and
best-effort open Moomoo's OpenD), plus wire the dashboard's existing health
indicators so clicking a broken one attempts to fix it.

**Architecture:** New standalone FastAPI app (`src/portfolio/launcher.py`, port
8002) with zero DB/broker dependencies — only spawns local processes on request.
Frontend gets a new health hook + Vite proxy entry (`/launcher/*` → `:8002`,
mirroring the existing `/api/*` → `:8001` bridge proxy) and wires click handlers
onto the existing `HealthTicker` bridge-down pill and a new `LiveJobsRow` button.

**Tech Stack:** Python (FastAPI, uvicorn, subprocess — all already project
dependencies), TypeScript/React (existing dashboard stack, TanStack Query, sonner
toasts).

**Spec:** `docs/superpowers/specs/2026-09-03-launcher-service-design.md`

## Global Constraints

- Loopback-only (127.0.0.1), no auth token — matches the bridge's own existing
  threat model (single-user local tool).
- Never automate the Zerodha 2FA login itself — the launcher only spawns
  processes; the daily manual browser login stays manual (CLAUDE.md guardrail #2).
- Port 8002 (next free after 8787 Zerodha daemon / 8001 bridge / 8000 Cardora /
  4096 opencode / 5173 Vite).
- This repo adds tests deliberately, not by default (per `AGENTS.md` / CLAUDE.md
  "Working conventions"): verification below uses the real process + curl/browser
  checks rather than a forced pytest suite for simple subprocess-spawn code.
- Follow existing code patterns exactly where one already exists (the
  `DETACHED_PROCESS` spawn pattern from `snapshot.py::_spawn_zerodha_daemon`,
  the `.cmd` wrapper + `register_*.ps1`/`unregister_*.ps1` pattern from
  `scripts/scheduler/`).

---

### Task 1: Launcher service core (`GET /health`, `POST /start/bridge`)

**Files:**
- Create: `src/portfolio/launcher.py`

**Interfaces:**
- Produces: `app` (FastAPI instance), run via `python -m portfolio.launcher`
  (mirrors `portfolio.bridge`'s own `if __name__ == "__main__"` block).

- [ ] **Step 1: Write `src/portfolio/launcher.py`**

```python
"""Launcher — a tiny, always-on, standalone process whose only job is to spawn
other local processes on request (bridge, OpenD). Separate from
portfolio.bridge on purpose: it must keep working even when the bridge itself
is the thing that's broken, so it has zero DB/broker/export dependencies —
nothing here can meaningfully crash.

Endpoints:
    GET  /health        -> {"ok": true}
    POST /start/bridge   -> {"ok": true, "started": bool}
    POST /start/opend    -> {"ok": true, "started": bool} | 422 {"ok": false, "error": str}

Guardrails:
    - Loopback only (127.0.0.1), no auth — same threat model as the bridge
      itself (single-user local tool).
    - Never automates the Zerodha 2FA login — this only spawns the bridge
      process; ensure_zerodha_daemon() (called by the bridge's own snapshot
      endpoints once it's up) still opens the Kite login browser for the
      user's manual 2FA, unchanged.
"""

from __future__ import annotations

import logging
import os
import socket
import subprocess
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from portfolio.config import DATA_DIR, ROOT_DIR

logger = logging.getLogger("portfolio.launcher")

app = FastAPI(title="Portfolio Launcher")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://127.0.0.1:5174", "http://127.0.0.1:5175"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

LAUNCHER_LOG = DATA_DIR / "logs" / "launcher_targets.log"
BRIDGE_PORT = int(os.environ.get("PORTFOLIO_BRIDGE_PORT", "8001"))


def _port_listening(port: int, host: str = "127.0.0.1", timeout: float = 1.0) -> bool:
    """Plain TCP connect check — no HTTP call, so this works even against a
    target that's up but not yet accepting HTTP (e.g. mid-startup)."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        try:
            sock.connect((host, port))
            return True
        except OSError:
            return False


def _spawn_detached(args: list[str], *, cwd: Path = ROOT_DIR) -> None:
    LAUNCHER_LOG.parent.mkdir(parents=True, exist_ok=True)
    flags = 0
    if os.name == "nt":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    with open(LAUNCHER_LOG, "ab") as fh:
        subprocess.Popen(
            args,
            cwd=str(cwd),
            stdout=fh,
            stderr=subprocess.STDOUT,
            creationflags=flags,
            close_fds=True,
        )


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


@app.post("/start/bridge")
async def start_bridge() -> dict:
    """Spawn `python -m portfolio.bridge` detached, unless :8001 is already
    listening (idempotent — a double-click can't cause duplicate processes or
    a port conflict)."""
    if _port_listening(BRIDGE_PORT):
        return {"ok": True, "started": False}
    _spawn_detached([sys.executable, "-m", "portfolio.bridge"])
    logger.info("spawned bridge (log: %s)", LAUNCHER_LOG)
    return {"ok": True, "started": True}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORTFOLIO_LAUNCHER_PORT", "8002"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
```

- [ ] **Step 2: Verify it starts and responds**

Run: `uv run python -m portfolio.launcher`
In another shell: `curl -s http://127.0.0.1:8002/health`
Expected: `{"ok":true}`

- [ ] **Step 3: Verify `/start/bridge` idempotency**

With the bridge already running, run:
`curl -s -X POST http://127.0.0.1:8002/start/bridge`
Expected: `{"ok":true,"started":false}` (no duplicate process spawned — confirm
with `Get-NetTCPConnection -LocalPort 8001` showing exactly one owning PID
before and after).

Stop the bridge, repeat the same curl.
Expected: `{"ok":true,"started":true}`, and `curl -s http://127.0.0.1:8001/api/health`
succeeds within ~2-3 seconds.

- [ ] **Step 4: Lint**

Run: `uv run ruff check src/portfolio/launcher.py`
Expected: `All checks passed!`

- [ ] **Step 5: Commit**

```bash
git add src/portfolio/launcher.py
git commit -m "feat: add launcher service for click-to-restart bridge"
```

---

### Task 2: `POST /start/opend` (Moomoo)

**Files:**
- Modify: `src/portfolio/launcher.py`

**Interfaces:**
- Consumes: `_spawn_detached` from Task 1 (same signature).
- Produces: `POST /start/opend` endpoint.

- [ ] **Step 1: Add the OpenD path search + endpoint**

```python
# Common Windows OpenD install locations, checked in order. PORTFOLIO_OPEND_PATH
# overrides both when set, since the real install location varies per user and
# there is no reliable way to auto-detect every install.
_OPEND_CANDIDATES = [
    Path(os.environ["PORTFOLIO_OPEND_PATH"]) if os.environ.get("PORTFOLIO_OPEND_PATH") else None,
    Path(os.environ.get("LOCALAPPDATA", "")) / "OpenD" / "OpenD.exe",
    Path("C:/Program Files/OpenD/OpenD.exe"),
    Path("C:/Program Files (x86)/OpenD/OpenD.exe"),
]


def _find_opend() -> Path | None:
    for candidate in _OPEND_CANDIDATES:
        if candidate is not None and candidate.is_file():
            return candidate
    return None


@app.post("/start/opend")
async def start_opend() -> dict:
    """Best-effort: OpenD has no fixed install path, so this checks a short
    list of common Windows locations (plus PORTFOLIO_OPEND_PATH override) and
    degrades to a clear error rather than guessing wrong."""
    exe = _find_opend()
    if exe is None:
        return JSONResponse(
            status_code=422,
            content={
                "ok": False,
                "error": "OpenD executable not found — open it manually, or set PORTFOLIO_OPEND_PATH",
            },
        )
    _spawn_detached([str(exe)], cwd=exe.parent)
    logger.info("spawned OpenD from %s", exe)
    return {"ok": True, "started": True}
```

Add the missing import at the top: `from fastapi.responses import JSONResponse`.

- [ ] **Step 2: Verify the "not found" path**

Run: `uv run python -m portfolio.launcher` (restart to pick up the new route)
`curl -s -X POST http://127.0.0.1:8002/start/opend`
Expected (unless OpenD happens to be installed at a checked path on this
machine): HTTP 422, `{"ok":false,"error":"OpenD executable not found..."}`

- [ ] **Step 3: Lint**

Run: `uv run ruff check src/portfolio/launcher.py`
Expected: `All checks passed!`

- [ ] **Step 4: Commit**

```bash
git add src/portfolio/launcher.py
git commit -m "feat: add best-effort OpenD launch to launcher service"
```

---

### Task 3: Task Scheduler registration (always-on at logon)

**Files:**
- Create: `scripts/scheduler/run_launcher.cmd`
- Create: `scripts/scheduler/register_launcher.ps1`
- Create: `scripts/scheduler/unregister_launcher.ps1`

**Interfaces:**
- Consumes: nothing (standalone scripts, following the exact pattern of
  `scripts/scheduler/run_serve.cmd` + `register_tasks.ps1` +
  `unregister_tasks.ps1`).

- [ ] **Step 1: Write `scripts/scheduler/run_launcher.cmd`**

```bat
@echo off
REM run_launcher.cmd - Task Scheduler wrapper for the launcher service.
REM Task: PortfolioLauncher. Register via register_launcher.ps1, remove via
REM unregister_launcher.ps1. DELIBERATE EXCEPTION to this repo's on-demand-only
REM scheduling policy (see register_tasks.ps1's header): the launcher's whole
REM purpose is to be alive when everything else (bridge, daemon) isn't, so it
REM must run continuously from logon, not on a calendar trigger.
setlocal
set "ROOT=%~dp0..\.."
if not exist "%ROOT%\data\logs" mkdir "%ROOT%\data\logs"
"%ROOT%\.venv\Scripts\python.exe" -m portfolio.launcher >> "%ROOT%\data\logs\launcher.log" 2>&1
```

- [ ] **Step 2: Write `scripts/scheduler/register_launcher.ps1`**

```powershell
# register_launcher.ps1 - registers PortfolioLauncher: an ALWAYS-ON task that
# starts at user logon and keeps running (not a daily calendar trigger like
# the rest of scripts/scheduler/ — see run_launcher.cmd's header for why this
# is a deliberate exception to the on-demand-only policy).
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Wrapper = Join-Path $Root 'scripts\scheduler\run_launcher.cmd'

$Xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Portfolio launcher: always-on process spawner (bridge/OpenD restart), starts at logon</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$Wrapper</Command>
      <WorkingDirectory>$Root</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

$TmpXml = New-TemporaryFile
Set-Content -Path $TmpXml -Value $Xml -Encoding Unicode
schtasks.exe /Create /TN 'PortfolioLauncher' /XML $TmpXml.FullName /F
Remove-Item $TmpXml
Write-Host "Registered PortfolioLauncher (starts at logon, restarts on failure)."
```

Note: `ExecutionTimeLimit PT0S` = unlimited (the task is meant to run
indefinitely, unlike the rest of this project's scheduled tasks which are
short-lived one-shots).

- [ ] **Step 3: Write `scripts/scheduler/unregister_launcher.ps1`**

```powershell
# unregister_launcher.ps1 - reversal for register_launcher.ps1.
#Requires -Version 5.1
& schtasks.exe /Delete /TN 'PortfolioLauncher' /F 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "deleted: PortfolioLauncher"
} else {
    Write-Host "not found - skipping: PortfolioLauncher"
}
```

- [ ] **Step 4: Verify registration (ask user before running — modifies Task Scheduler)**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\scheduler\register_launcher.ps1`
Then: `powershell.exe -NoProfile -Command "Get-ScheduledTask -TaskName PortfolioLauncher | Select-Object TaskName, State"`
Expected: `PortfolioLauncher    Ready`

- [ ] **Step 5: Commit**

```bash
git add scripts/scheduler/run_launcher.cmd scripts/scheduler/register_launcher.ps1 scripts/scheduler/unregister_launcher.ps1
git commit -m "feat: register launcher service as always-on Task Scheduler entry"
```

---

### Task 4: Vite proxy + frontend launcher client + health hook

**Files:**
- Modify: `dashboard/vite.config.ts`
- Create: `dashboard/src/lib/launcherApi.ts`
- Create: `dashboard/src/lib/useLauncherHealth.ts`

**Interfaces:**
- Produces: `getLauncherHealth(): Promise<boolean>`,
  `startBridge(): Promise<{ok: boolean; started: boolean}>`,
  `startOpenD(): Promise<{ok: boolean; started: boolean; error?: string}>`
  (all in `launcherApi.ts`); `useLauncherHealth(pollMs?: number): boolean`
  (in `useLauncherHealth.ts`) — consumed by Task 5.

- [ ] **Step 1: Add the `/launcher` proxy entry to `dashboard/vite.config.ts`**

Find the existing `proxy: { '/api': {...} }` block and add a sibling entry:

```typescript
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        timeout: 600000,
      },
      '/launcher': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        timeout: 10000,
      },
    },
```

Update the file's header comment (the one above `export default defineConfig`)
to mention the new proxy entry, following its existing style:

```
// - `/launcher/*` is proxied to the launcher service (src/portfolio/launcher.py,
//   127.0.0.1:8002) — a separate always-on process that can restart the bridge
//   even when the bridge itself is down. Short timeout: launcher calls only
//   spawn a detached process and return immediately.
```

- [ ] **Step 2: Write `dashboard/src/lib/launcherApi.ts`**

```typescript
/**
 * Launcher HTTP client — talks to the standalone launcher service through the
 * Vite dev proxy (/launcher/* -> 127.0.0.1:8002). Separate from api.ts (the
 * bridge client) on purpose: the launcher must be reachable independently of
 * bridge health, since its whole point is fixing a down bridge.
 */

const LAUNCHER_ROOT = '/launcher'

export async function getLauncherHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${LAUNCHER_ROOT}/health`)
    if (!res.ok) return false
    const body: unknown = await res.json()
    return typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true
  } catch {
    return false
  }
}

export interface LauncherStartResponse {
  ok: boolean
  started: boolean
  error?: string
}

export async function startBridge(): Promise<LauncherStartResponse> {
  const res = await fetch(`${LAUNCHER_ROOT}/start/bridge`, { method: 'POST' })
  const body = (await res.json()) as LauncherStartResponse
  return body
}

export async function startOpenD(): Promise<LauncherStartResponse> {
  const res = await fetch(`${LAUNCHER_ROOT}/start/opend`, { method: 'POST' })
  const body = (await res.json()) as LauncherStartResponse
  return body
}
```

- [ ] **Step 3: Write `dashboard/src/lib/useLauncherHealth.ts`**

```typescript
/**
 * Polls the launcher service's /health independently of useBackendHealth —
 * it must keep working even when the bridge itself is fully down, since
 * that's the exact case the launcher exists to recover from.
 */

import { useEffect, useState } from 'react'

import { getLauncherHealth } from '@/lib/launcherApi'

export function useLauncherHealth(pollMs = 10_000): boolean {
  const [reachable, setReachable] = useState(false)

  useEffect(() => {
    let alive = true
    const check = async () => {
      const ok = await getLauncherHealth()
      if (alive) setReachable(ok)
    }
    check()
    const id = window.setInterval(check, pollMs)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [pollMs])

  return reachable
}
```

- [ ] **Step 4: Typecheck**

Run: `cd dashboard && npm run typecheck`
Expected: no errors in the three touched/created files.

- [ ] **Step 5: Commit**

```bash
git add dashboard/vite.config.ts dashboard/src/lib/launcherApi.ts dashboard/src/lib/useLauncherHealth.ts
git commit -m "feat: add launcher proxy, API client, and health hook to dashboard"
```

---

### Task 5: Wire click-to-restart into `HealthTicker`'s bridge-down pill

**Files:**
- Modify: `dashboard/src/components/layout/HealthTicker.tsx`

**Interfaces:**
- Consumes: `useLauncherHealth` and `startBridge` from Task 4 (exact names/signatures above).

- [ ] **Step 1: Add imports and launcher state**

At the top of `HealthTicker.tsx`, add:

```typescript
import { useState } from 'react'
import { toast } from 'sonner'

import { useLauncherHealth } from '@/lib/useLauncherHealth'
import { startBridge } from '@/lib/launcherApi'
```

Inside `HealthTicker()`, alongside the existing `const health = useBackendHealth()`:

```typescript
  const launcherReachable = useLauncherHealth()
  const [restarting, setRestarting] = useState(false)

  const handleRestartBridge = async () => {
    if (!launcherReachable) {
      toast.info('Launcher not reachable — start the bridge manually', {
        description: 'Run: uv run python -m portfolio.bridge',
      })
      return
    }
    setRestarting(true)
    try {
      const result = await startBridge()
      toast.success(result.started ? 'Starting bridge…' : 'Bridge is already running')
    } catch (err) {
      toast.error('Failed to reach launcher', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setRestarting(false)
    }
  }
```

- [ ] **Step 2: Make the "bridge down" pill clickable**

Find the existing `agentPill` block (`health.status === 'backend-offline' ? { label: 'bridge down', ... }`)
and change its rendering from the plain `<span>` wrapper to a `<button>` only
in the `backend-offline` case. Locate the JSX block:

```tsx
        {/* Agent status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1.5">
              <Bot className={cn('size-3', agentPill.color)} />
              <span className={cn('size-1.5 rounded-full shrink-0', agentPill.dot)} />
              <span className={cn(agentPill.color)}>{agentPill.label}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent className="py-1 text-xs">{agentPill.tip}</TooltipContent>
        </Tooltip>
```

Replace with:

```tsx
        {/* Agent status (clickable to restart when the bridge itself is down) */}
        <Tooltip>
          <TooltipTrigger asChild>
            {health.status === 'backend-offline' ? (
              <button
                type="button"
                onClick={handleRestartBridge}
                disabled={restarting}
                className="inline-flex items-center gap-1.5 cursor-pointer hover:opacity-80 disabled:opacity-50"
              >
                <Bot className={cn('size-3', agentPill.color)} />
                <span className={cn('size-1.5 rounded-full shrink-0', agentPill.dot)} />
                <span className={cn(agentPill.color)}>{agentPill.label}</span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Bot className={cn('size-3', agentPill.color)} />
                <span className={cn('size-1.5 rounded-full shrink-0', agentPill.dot)} />
                <span className={cn(agentPill.color)}>{agentPill.label}</span>
              </span>
            )}
          </TooltipTrigger>
          <TooltipContent className="py-1 text-xs">
            {health.status === 'backend-offline'
              ? launcherReachable
                ? 'Bridge unreachable — click to start it.'
                : 'Bridge unreachable — launcher also unreachable. Run: uv run python -m portfolio.bridge'
              : agentPill.tip}
          </TooltipContent>
        </Tooltip>
```

- [ ] **Step 3: Typecheck + lint**

Run: `cd dashboard && npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verification**

With the bridge stopped and the launcher running: load the dashboard, confirm
the footer pill reads "bridge down" and is clickable; click it; confirm a
"Starting bridge…" toast appears and the pill recovers to "agent online"/
"agent offline" within ~10-15s (one poll cycle).

With the launcher also stopped: confirm clicking shows the manual-command toast
instead.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/layout/HealthTicker.tsx
git commit -m "feat: click bridge-down indicator to restart via launcher"
```

---

### Task 6: "Open OpenD" button in `LiveJobsRow`

**Files:**
- Modify: `dashboard/src/components/journey/LiveJobsRow.tsx`

**Interfaces:**
- Consumes: `startOpenD` from Task 4.

- [ ] **Step 1: Add the import**

```typescript
import { startOpenD } from '@/lib/launcherApi'
```

- [ ] **Step 2: Add an OpenD button next to the Moomoo retry button**

Inside `LiveJobItem`, after the existing retry `<Button>`, add a second button
that only renders for the `moomoo` platform:

```tsx
      {platform === 'moomoo' && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5"
          onClick={async () => {
            try {
              const result = await startOpenD()
              if (result.ok) {
                toast.success(result.started ? 'Opening OpenD…' : 'OpenD already running')
              } else {
                toast.error('Could not open OpenD', { description: result.error })
              }
            } catch (err) {
              toast.error('Launcher unreachable', { description: err instanceof Error ? err.message : String(err) })
            }
          }}
          title="Open the OpenD gateway app"
        >
          OpenD
        </Button>
      )}
```

- [ ] **Step 3: Typecheck + lint**

Run: `cd dashboard && npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Click "OpenD" in the Journey page's Moomoo row. If no OpenD install is found
at a checked path on this machine, confirm the error toast reads "OpenD
executable not found — open it manually, or set PORTFOLIO_OPEND_PATH".

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/journey/LiveJobsRow.tsx
git commit -m "feat: add Open OpenD button to Moomoo job row"
```

---

## Self-Review Notes (already applied above)

- **Spec coverage:** `/health`, `/start/bridge`, `/start/opend` (Task 1-2);
  Task Scheduler always-on registration (Task 3); frontend proxy + client +
  hook (Task 4); bridge-down click-to-fix with launcher-unreachable fallback
  (Task 5); Moomoo/OpenD button (Task 6). No `/start/zerodha` per spec's
  explicit non-duplication decision.
- **Type consistency:** `LauncherStartResponse` (Task 4) used identically in
  Task 5 (`startBridge`) and Task 6 (`startOpenD`) — same `{ok, started,
  error?}` shape both places.
- **No placeholders:** every step has runnable code; no "similar to Task N"
  shortcuts — Task 5 and 6 each show their exact JSX in full.
