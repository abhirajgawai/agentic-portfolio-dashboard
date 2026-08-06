"""Layer-1 allowlist + parse helpers for the Zerodha MCP client."""

from __future__ import annotations

import pytest

from portfolio.clients.base import to_tool_result
from portfolio.clients.zerodha import ALLOWLIST, ZerodhaMCPClient, extract_login_url


def test_allowlist_exposes_only_read_only_tools() -> None:
    forbidden = {"place_order", "modify_order", "cancel_order"}
    assert not (ALLOWLIST & forbidden), "order tools must never be on the allowlist"
    # no GTT write tools
    assert not any("gtt" in t and not t.startswith("get_") for t in ALLOWLIST)
    assert "get_holdings" in ALLOWLIST
    assert "get_quotes" in ALLOWLIST


def test_client_exposed_surface_equals_allowlist() -> None:
    client = ZerodhaMCPClient()
    assert client.exposed_tools == ALLOWLIST


def test_login_is_not_a_data_tool_but_has_dedicated_method() -> None:
    """login() is auth-only and NOT reachable through the data allowlist."""
    assert "login" not in ALLOWLIST
    assert hasattr(ZerodhaMCPClient(), "login")


@pytest.mark.asyncio
async def test_call_rejects_non_allowlisted_tool() -> None:
    client = ZerodhaMCPClient()
    with pytest.raises(PermissionError):
        await client.call("place_order", {})
    # not even allowed to touch wire if not connected


def test_extract_login_url() -> None:
    text = (
        "Please click: [Login to Kite](https://mcp.kite.trade/authorize?session_id=kitemcp-abc|123.sig%3D) "
        "or paste into browser."
    )
    assert extract_login_url(text) == "https://mcp.kite.trade/authorize?session_id=kitemcp-abc|123.sig%3D"


def test_extract_login_url_none_when_absent() -> None:
    assert extract_login_url("no link here") is None


def test_to_tool_result_marks_login_required() -> None:
    class _Text:
        type = "text"
        text = "Please log in first using the login tool"

    class _Res:
        is_error = True
        content = [_Text()]

    res = to_tool_result("get_holdings", _Res())
    assert res.is_error
    assert res.login_required()


# Skill gate: pinned raw samples exist and are valid JSON.
def test_pinned_samples_exist_and_valid() -> None:
    import json

    from portfolio.config import SAMPLES_DIR

    for name in ("_tools.json", "get_holdings.json", "login.json"):
        p = SAMPLES_DIR / "zerodha" / f"{name}"
        assert p.exists(), f"missing pinned sample samples/zerodha/{name}"
        json.loads(p.read_text(encoding="utf-8"))