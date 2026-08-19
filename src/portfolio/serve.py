"""Zerodha session daemon.

Holds ONE authenticated MCP connection for the trading day (the hosted server
does not support cross-connection session resumption), and exposes a loopback
RPC endpoint that snapshot runs call. Pattern:

    Task Scheduler (09:35 IST)  ->  portfolio serve --platform zerodha
      connects, does the one daily manual login, then serves:
         GET  /health  -> session/serving status
         POST /rpc     -> {"tool": "get_holdings", "args": {}} -> raw result
    Task Scheduler (09:45/15:45) -> portfolio snapshot --platform zerodha
      posts /rpc calls to the daemon; records a `runs` row; expired -> Telegram.

Why one asyncio task owns the lifecycle: mcp's ClientSession/transport create
anyio task groups on connect(). anyio requires a task group to be exited by the
SAME task that entered it - so connect(), serving, and close() all run inside
the single `_run()` coroutine below, never split across uvicorn's
lifespan startup/shutdown tasks.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from portfolio.clients.zerodha import ZerodhaMCPClient
from portfolio.tokens import zerodha_login

logger = logging.getLogger("portfolio.serve")

DEFAULT_PORT = 8787
HEARTBEAT_SECONDS = 45


class DaemonState:
    def __init__(self) -> None:
        self.client: ZerodhaMCPClient | None = None
        self.connected = False
        self.health: dict[str, Any] = {"auth": False}
        self.heartbeat_task: asyncio.Task | None = None


state = DaemonState()


async def _heartbeat_loop() -> None:
    while True:
        try:
            if state.client is not None:
                await state.client.ping()
                state.connected = True
        except Exception as exc:  # noqa: BLE001 - connection may be dead
            state.connected = False
            state.health = {"auth": False, "detail": f"connection lost: {exc}"}
            logger.error("daemon heartbeat failed: %s", exc)
        await asyncio.sleep(HEARTBEAT_SECONDS)


async def health(request: Request) -> JSONResponse:
    auth = False
    detail = None
    if state.client is not None and state.connected:
        auth, detail = await state.client.check_auth()
    state.health = {"auth": auth, "detail": detail}
    return JSONResponse({"ok": state.connected, "auth": auth, "detail": detail, "port": DEFAULT_PORT})


async def rpc(request: Request) -> JSONResponse:
    # Trust model (MINOR-8): /rpc is unauthenticated BY DESIGN on a personal
    # box. It binds 127.0.0.1 only, and the ONLY tools it can reach are the
    # client's read-only allowlist (guardrail #1) - there is nothing an attacker
    # who can already run code on this machine could do here that they could not
    # do directly, and the daemon never exposes credentials. No order tools,
    # no write path, ever.
    client = state.client
    if client is None or not state.connected:
        return JSONResponse(
            {"error": "zerodha daemon not connected - run `portfolio serve --platform zerodha`"},
            status_code=503,
        )
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({"error": "invalid JSON body"}, status_code=400)

    tool = body.get("tool")
    args = body.get("args") or {}
    if not tool:
        return JSONResponse({"error": "missing 'tool'"}, status_code=400)

    try:
        res = await client.call(tool, args)
    except PermissionError as exc:
        return JSONResponse({"error": str(exc)}, status_code=403)  # guardrail #1
    except Exception as exc:  # noqa: BLE001 - transport error
        state.connected = False
        state.health = {"auth": False, "detail": str(exc)}
        return JSONResponse({"error": f"daemon error: {exc}"}, status_code=503)

    return JSONResponse(
        {
            "tool": tool,
            "is_error": res.is_error,
            "error": res.error,
            "texts": res.texts,
            "raw": res.raw,
            "login_required": res.login_required(),
        }
    )


routes = [
    Route("/health", health, methods=["GET"]),
    Route("/rpc", rpc, methods=["POST"]),
]

app = Starlette(routes=routes)


async def _run(host: str, port: int) -> None:
    client = ZerodhaMCPClient()
    try:
        await client.connect()
        outcome = await zerodha_login.ensure_authenticated(client, open_browser=True)

        state.client = client
        state.connected = True
        if not outcome.ok:
            state.health = {"auth": False, "detail": outcome.detail}
            logger.warning("daemon up but NOT authenticated: %s", outcome.detail)
        else:
            state.health = {"auth": True}
            logger.info("zerodha daemon authenticated")
            state.heartbeat_task = asyncio.get_running_loop().create_task(_heartbeat_loop())

        config = uvicorn.Config(app, host=host, port=port, log_level="warning")
        server = uvicorn.Server(config)
        await server.serve()
    finally:
        # Exit task groups from the SAME task that entered them (anyio rule).
        state.connected = False
        if state.heartbeat_task:
            state.heartbeat_task.cancel()
        await client.close()
        logger.info("zerodha daemon stopped")


def run(host: str = "127.0.0.1", port: int = DEFAULT_PORT) -> None:
    if _daemon_healthy(host, port):
        # A scheduled 09:35 IST serve firing while a daemon is already up (e.g.
        # one started manually) must NOT open a SECOND hosted-MCP connection,
        # prompt a SECOND daily login, and then die on the port bind. The live
        # daemon already serves /rpc to snapshots - exit 0 quietly instead.
        print(f"zerodha daemon already running on {host}:{port} - not starting a second one")
        return
    asyncio.run(_run(host, port))


def _daemon_healthy(host: str, port: int) -> bool:
    """True when a portfolio serve daemon is already answering /health with ok.

    Read-only probe (loopback GET, 2s timeout). Any failure - connection
    refused, non-JSON, unhealthy response - means "no usable daemon" and the
    caller proceeds with the normal start (a stale/unhealthy process must not
    block a fresh daemon).
    """
    try:
        resp = httpx.get(f"http://{host}:{port}/health", timeout=2.0)
        return resp.status_code == 200 and bool(resp.json().get("ok"))
    except Exception:  # noqa: BLE001 - any failure means "no daemon": proceed
        return False