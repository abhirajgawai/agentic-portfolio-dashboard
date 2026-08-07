"""Moomoo MCP client (local read-only FastMCP over the OpenD gateway).

Spike conclusion (2026-08-06): the hosted MCP (mcp.moomoo.com) only grants
`quote:read` to dynamically-registered OAuth clients, so its account tools 401.
PLAN.md's fallback: we run our own read-only MCP server (moomoo_mcp/server.py)
against the OpenD gateway (127.0.0.1:11111) and this client talks to it over
stdio. OpenD holds the Moomoo session; this client never sees credentials.

Guardrail #1 (two-layer allowlist, layer 1): exposes ONLY the wrapper's
read-only tools; `call()` hard-rejects anything else. Order place/modify/cancel
tools are never referenced - the wrapper does not even register them.
"""

from __future__ import annotations

import logging
import sys

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

from portfolio.clients.base import ToolResult, to_tool_result
from portfolio.config import ROOT_DIR

logger = logging.getLogger("portfolio.clients.moomoo")

# Read-only allowlist - mirrors the tool set registered in moomoo_mcp/server.py.
ALLOWLIST = frozenset(
    {
        "get_accounts",  # acc_id source for the other calls
        "get_positions",  # holdings with cost/price/P&L -> normalizer input
        "get_funds",  # total assets / market value / cash (USD)
        "get_fills",  # today's executed trades -> daily ledger (XIRR)
    }
)


class MoomooMCPClient:
    """Stdio client to the local moomoo_mcp server (spawned per run)."""

    def __init__(self) -> None:
        self._session: ClientSession | None = None
        self._transport: object | None = None
        self._closed = False

    @property
    def exposed_tools(self) -> frozenset[str]:
        """Layer-1 allowlist surface. Tests assert no extras."""
        return ALLOWLIST

    async def __aenter__(self) -> MoomooMCPClient:
        await self.connect()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    async def connect(self) -> None:
        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "moomoo_mcp.server"],
            cwd=str(ROOT_DIR),
        )
        self._transport = stdio_client(params)
        read, write = await self._transport.__aenter__()
        self._session = ClientSession(read, write)
        await self._session.__aenter__()
        await self._session.initialize()
        self._closed = False
        logger.info("connected to local moomoo MCP server")

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            if self._session is not None:
                await self._session.__aexit__(None, None, None)
        finally:
            if self._transport is not None:
                await self._transport.__aexit__(None, None, None)
            self._session = None
            logger.info("closed moomoo MCP connection")

    async def call(self, tool: str, args: dict | None = None) -> ToolResult:
        """Call a tool if (and only if) it is on the allowlist."""
        if tool not in ALLOWLIST:
            # Guardrail #1: never even attempt a non-allowlisted tool.
            raise PermissionError(f"tool {tool!r} is not on the Moomoo read-only allowlist")
        if self._session is None:
            raise RuntimeError("client not connected")
        logger.debug("moomoo.call(%s)", tool)
        result = await self._session.call_tool(tool, args or {})
        return to_tool_result(tool, result)

    async def check_auth(self) -> tuple[bool, str]:
        """True if the wrapper can reach OpenD and list accounts."""
        try:
            res = await self.call("get_accounts")
        except Exception as exc:  # noqa: BLE001 - surface as unauth/error detail
            return False, f"{type(exc).__name__}: {exc}"
        if res.is_error:
            return False, (res.error or res.raw[:120] or "get_accounts failed")
        return True, res.raw[:120]
