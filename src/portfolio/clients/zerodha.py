"""Zerodha MCP client (hosted mcp.kite.trade).

Guardrail #1 (two-layer allowlist, layer 1): this class exposes ONLY the
read-only tools in ALLOWLIST. `call()` hard-rejects anything else. Order
place/modify/cancel/GTT tools are never referenced here.
"""

from __future__ import annotations

import logging
import re

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from portfolio.clients.base import ToolResult, to_tool_result

logger = logging.getLogger("portfolio.clients.zerodha")

KITE_MCP_URL = "https://mcp.kite.trade/mcp"

# Read-only allowlist (verified against live inventory 2026-08-06, v0.3.2).
ALLOWLIST = frozenset(
    {
        "get_profile",
        "get_holdings",
        "get_positions",
        "get_mf_holdings",
        "get_margins",
        "get_quotes",
        "get_ltp",
        "get_ohlc",
        "get_historical_data",
        "get_orders",  # read-only; trade history capture (M3)
        "get_trades",  # read-only; trade history capture (M3)
        "get_order_history",  # read-only
        "get_order_trades",  # read-only
        "get_gtts",  # read-only listing
        "search_instruments",  # read-only
    }
)

# Logged-in profile marker: the server returns user info when authenticated.
PROFILE_OK_HINT = "user"


def extract_login_url(text: str) -> str | None:
    """Pull the authorize URL out of the login tool's text payload."""
    m = re.search(r"https://mcp\.kite\.trade/authorize\?session_id=[^\s)\]]+", text)
    return m.group(0) if m else None


class ZerodhaMCPClient:
    """Owns one streamable-HTTP connection to the hosted Kite MCP server.

    The hosted server does NOT support cross-connection session resumption, so
    the caller must keep this object (and its connection) alive for the whole
    trading day - see portfolio.serve (daemon) for the persistent-connection
    design that makes scheduled snapshots possible.
    """

    def __init__(self, url: str = KITE_MCP_URL) -> None:
        self.url = url
        self._session: ClientSession | None = None
        self._read: object | None = None
        self._write: object | None = None
        self._transport_cm: object | None = None
        self._closed = False

    @property
    def exposed_tools(self) -> frozenset[str]:
        """Layer-1 allowlist surface. Tests assert no extras."""
        return ALLOWLIST

    async def __aenter__(self) -> ZerodhaMCPClient:
        await self.connect()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    async def connect(self) -> None:
        cm = streamable_http_client(self.url)
        self._transport_cm = cm
        read, write = await cm.__aenter__()
        self._read, self._write = read, write
        self._session = ClientSession(read, write)
        # __aenter__ starts the dispatcher task-group; without it, initialize()
        # fails with "JSONRPCDispatcher.send_raw_request called before run()".
        await self._session.__aenter__()
        await self._session.initialize()
        self._closed = False
        logger.info("connected to Kite MCP (%s)", self.url)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            if self._session is not None:
                await self._session.__aexit__(None, None, None)
        finally:
            if self._transport_cm is not None:
                await self._transport_cm.__aexit__(None, None, None)
            self._session = None
            logger.info("closed Kite MCP connection")

    async def login(self) -> ToolResult:
        """Initiate the daily MANUAL browser login (auth-only, never order-placing).

        Deliberately NOT on the data allowlist: only the interactive login helper
        (tokens/zerodha_login.py) calls this, never the daemon's /rpc surface.
        """
        if self._session is None:
            raise RuntimeError("client not connected")
        result = await self._session.call_tool("login", {})
        return to_tool_result("login", result)

    async def call(self, tool: str, args: dict | None = None) -> ToolResult:
        """Call a tool if (and only if) it is on the allowlist."""
        if tool not in ALLOWLIST:
            # Guardrail #1: never even attempt a non-allowlisted tool.
            raise PermissionError(
                f"tool {tool!r} is not on the Zerodha read-only allowlist"
            )
        if self._session is None:
            raise RuntimeError("client not connected")
        logger.debug("zerodha.call(%s)", tool)
        result = await self._session.call_tool(tool, args or {})
        return to_tool_result(tool, result)

    async def check_auth(self) -> tuple[bool, str]:
        """True if the connection has a live Kite session (get_profile works)."""
        try:
            res = await self.call("get_profile")
        except Exception as exc:  # noqa: BLE001 - surface as unauth/error detail
            return False, f"{type(exc).__name__}: {exc}"
        if res.login_required():
            return False, res.raw[:120]
        if res.is_error:
            return False, (res.error or res.raw[:120] or "get_profile failed")
        return True, res.raw[:120]

    async def ping(self) -> None:
        if self._session is None:
            raise RuntimeError("client not connected")
        await self._session.send_ping()
