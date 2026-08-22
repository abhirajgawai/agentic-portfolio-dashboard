"""Wake-on-demand for the M7 agent runtime - spawn `opencode serve` when the
dashboard finds it offline.

WHY THIS MODULE EXISTS
----------------------
The dashboard's chat panel needs `opencode serve` (the agent runtime) running
on 127.0.0.1:4096. It is not a scheduled service: it is a long-lived dev
process that can be down (reboot, crash, closed terminal). Rather than making
the user start it by hand, the UI fires POST /api/agent/wake and this module
brings it up. /api/ask deliberately does NOT self-heal - it keeps its exact
503 behavior - the wake is an explicit, separate action the UI takes.

WHY THE SPAWN IS DETACHED (DETACHED_PROCESS | CREATE_NO_WINDOW)
--------------------------------------------------------------
The spawned server must outlive the bridge process that spawned it: the
bridge is restarted often (uvicorn --reload, edits, crashes) and the agent
session would die with it. DETACHED_PROCESS creates a child with no console
of its own, so it keeps running after the parent exits; CREATE_NO_WINDOW
stops a console window from popping up when the wake fires from a
scheduled/headless context. On POSIX the same intent is already the default
- no flags needed, so we pass 0 there.

WHY env = os.environ UNCHANGED
------------------------------
The client authenticates to a password-protected serve via
OPENCODE_SERVER_PASSWORD / OPENCODE_SERVER_USERNAME read from ITS environment
(portfolio/agent/client.py). The production serve must be started with the
SAME environment, or the freshly woken server would reject the client's Basic
auth. Nothing is stripped - unlike scripts/eval_agent.py, which spawns an
UNAUTHENTICATED ephemeral server and deliberately removes those two vars. The
child inherits exactly what the bridge process has; no secret is logged or
echoed anywhere in this path.

WHY THE MODULE-LEVEL LOCK
-------------------------
Two dashboard tabs (or a tab plus the UI's retry) can fire the wake at the
same instant. Without a guard they would spawn TWO servers fighting over port
4096. The lock serialises the spawn decision. A caller that arrives while a
spawn is in flight awaits the SAME outcome instead of spawning again; a
still-alive process from a previous wake short-circuits to "started". The
invariant: at most one spawned server is alive per wake wave - the next wake
re-spawns only when the previous process is gone.

WHY NO HEALTH POLL AFTER SPAWN
------------------------------
A fresh serve takes seconds to boot; /global/health would return False for
that whole window and the wake would have to poll - exactly what the UI
already does (a ~10s health poll that decides whether the chat panel is
online). So the wake returns "started" the moment the process has proven it
will not die in the first seconds (busy port / EADDRINUSE / missing config),
and the UI's own poll is the source of truth. The only wait here is a short
early-exit watch (`EARLY_EXIT_WINDOW_S`) that turns a dying process into a
clear AgentWakeError instead of a phantom "started".
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import time
from pathlib import Path

from portfolio.agent.client import OpenCodeClient
from portfolio.config import ROOT_DIR

logger = logging.getLogger("portfolio.agent.wake")

# The agent server the client talks to (client.DEFAULT_BASE_URL) - the wake
# must spawn on exactly this port/host or the client would never connect.
SERVE_PORT = 4096
SERVE_HOST = "127.0.0.1"

# Child output lands in data/logs/ (gitignored - same convention as
# data/logs/zerodha_serve.log), never on the parent's stdout.
SERVE_LOG_PATH = ROOT_DIR / "data" / "logs" / "opencode_serve.log"

# How long to watch a freshly spawned process for an immediate exit
# (EADDRINUSE on a busy port, bad config, a missing cmd shim). A healthy
# serve never exits, so this window is the only cost of a successful wake.
EARLY_EXIT_WINDOW_S = 2.0

# The known npm install location for `opencode` on this box - the fallback
# after the OPENCODE_BIN env override, before the bare-PATH cmd shim.
_NPM_OPENCODE_EXE = Path(
    r"C:\Users\Abhiraj Gautam Gavai\AppData\Roaming\npm\node_modules\opencode-ai\bin\opencode.exe"
)


class AgentWakeError(Exception):
    """The wake path could not bring the agent online (exe missing, spawn failed)."""


# One spawn per wake wave: the lock serialises the spawn decision and the
# module state below lets a concurrent caller share the in-flight outcome.
_SPAWN_LOCK = asyncio.Lock()
_spawn_in_flight: asyncio.Task[str] | None = None
_spawned_proc: subprocess.Popen | None = None


def resolve_opencode_exe() -> Path:
    """Locate the opencode executable - mirrors scripts/eval_agent.py's
    resolution exactly: the OPENCODE_BIN env override if it exists, else the
    known npm install path, else a bare `opencode` for the cmd shim on PATH.
    """
    _bin = os.environ.get("OPENCODE_BIN", "").strip()
    _candidate = Path(_bin) if _bin else None
    exe = _candidate if _candidate is not None and _candidate.exists() else _NPM_OPENCODE_EXE
    if not exe.exists():
        exe = Path("opencode")
    return exe


def _log_head(path: Path, limit: int = 300) -> str:
    """The first `limit` chars of the serve log - the failure evidence.

    A dying serve prints its reason (EADDRINUSE etc.) early in a fresh log,
    so the head carries the diagnosis. Read back with errors="replace" - the
    log is written in binary by the child, encoding is not guaranteed.
    """
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return "(log unavailable)"
    return text[:limit]


async def _spawn_server(*, wait_s: float) -> str:
    """Spawn `opencode serve` detached and watch briefly for an early exit.

    Returns "started"; raises AgentWakeError when the exe is unresolvable,
    the spawn itself fails, or the process dies inside the early-exit watch
    (busy port / EADDRINUSE / a missing cmd shim on PATH).
    """
    global _spawned_proc
    exe = resolve_opencode_exe()
    if exe.parent != Path(".") and not exe.exists():
        raise AgentWakeError(f"opencode executable not found: {exe}")

    use_shell = exe.parent == Path(".")  # bare `opencode` -> cmd shim, like the eval
    cmd = ["serve", "--port", str(SERVE_PORT), "--hostname", SERVE_HOST]
    args = ["opencode", *cmd] if use_shell else [str(exe), *cmd]
    creationflags = (
        subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS
        if os.name == "nt"
        else 0
    )
    try:
        SERVE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with SERVE_LOG_PATH.open("ab") as log_handle:
            _spawned_proc = subprocess.Popen(
                args,
                cwd=ROOT_DIR,  # the project config (.opencode/opencode.json) must load
                env=os.environ.copy(),
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                shell=use_shell,
                creationflags=creationflags,
            )
    except OSError as exc:
        raise AgentWakeError(f"failed to start opencode serve: {exc}") from exc

    # Early-exit watch: a healthy serve never exits, so the loop returns the
    # moment the window closes - never a /global/health poll (the UI's own
    # poll is the source of truth).
    deadline = time.monotonic() + min(wait_s, EARLY_EXIT_WINDOW_S)
    while time.monotonic() < deadline:
        if _spawned_proc.poll() is not None:
            raise AgentWakeError(
                f"opencode serve exited immediately (code {_spawned_proc.returncode}): "
                f"{_log_head(SERVE_LOG_PATH)}"
            )
        await asyncio.sleep(0.1)
    logger.info("opencode serve spawned detached (pid %s)", _spawned_proc.pid)
    return "started"


async def ensure_agent_online(*, wait_s: float = 60.0) -> str:
    """Bring the agent online if it is not already; returns "already-online"
    when the server answers health, "started" after a fresh spawn.

    wait_s bounds the early-exit watch for the freshly spawned process; it is
    internally capped by EARLY_EXIT_WINDOW_S so a healthy spawn returns
    promptly instead of blocking the endpoint.
    """
    client = OpenCodeClient()
    if await client.health():
        return "already-online"

    async with _SPAWN_LOCK:
        # Re-check under the lock: the caller that held it before us may have
        # just spawned a server (and its process is already answering).
        if await client.health():
            return "already-online"

        global _spawn_in_flight
        # A concurrent wake is mid-spawn: await the SAME outcome - the lock
        # guarantees at most one spawner at a time.
        if _spawn_in_flight is not None and not _spawn_in_flight.done():
            return await asyncio.shield(_spawn_in_flight)
        # A previous wake left a still-alive server: it is our server, treat
        # the wake as satisfied (the UI's health poll confirms it).
        if _spawned_proc is not None and _spawned_proc.poll() is None:
            return "started"

        _spawn_in_flight = asyncio.create_task(_spawn_server(wait_s=wait_s))
        try:
            return await asyncio.shield(_spawn_in_flight)
        finally:
            _spawn_in_flight = None