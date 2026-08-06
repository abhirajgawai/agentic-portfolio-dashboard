"""Layer-1 allowlist + wrapper contract for the Moomoo client (OpenD-backed)."""

from __future__ import annotations

import pytest

from portfolio.clients.moomoo import ALLOWLIST, MoomooMCPClient


def test_allowlist_exposes_only_read_only_tools() -> None:
    forbidden = {"place_order", "modify_order", "cancel_order", "unlock_trade", "trading_order_place"}
    assert not (ALLOWLIST & forbidden), "order/write tools must never be on the allowlist"
    assert {"get_accounts", "get_positions", "get_funds"} <= ALLOWLIST


def test_client_exposed_surface_equals_allowlist() -> None:
    client = MoomooMCPClient()
    assert client.exposed_tools == ALLOWLIST


@pytest.mark.asyncio
async def test_call_rejects_non_allowlisted_tool() -> None:
    client = MoomooMCPClient()
    with pytest.raises(PermissionError):
        await client.call("place_order", {})
    with pytest.raises(PermissionError):
        await client.call("trading_order_place", {})


@pytest.mark.asyncio
async def test_wrapper_registers_only_read_only_tools() -> None:
    """The OpenD wrapper's own tool surface must match the client allowlist."""
    from moomoo_mcp.server import server

    tools = await server.list_tools()
    names = {t.name for t in tools}
    assert names == ALLOWLIST, f"wrapper exposes {names}, allowlist expects {ALLOWLIST}"
    assert not any("order" in n for n in names), "wrapper must never register order tools"
