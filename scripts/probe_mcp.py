"""MCP inspection probe (skill: mcp-inspection).

Connects to a broker MCP endpoint, lists tools, calls a set of READ-ONLY tools,
and dumps raw responses to samples/<platform>/<tool>.json with secret redaction
applied before saving.

Usage:
    uv run python scripts/probe_mcp.py --url https://mcp.kite.trade/mcp --platform zerodha
    uv run python scripts/probe_mcp.py --url https://mcp.moomoo.com/mcp --platform moomoo \
        --tools get_account_summary,get_holdings
    # Moomoo is OAuth-protected: --auth moomoo starts the one-time consent flow
    # (browser) if no valid token is stored, then auto-refreshes on demand.
    uv run python scripts/probe_mcp.py --url https://mcp.moomoo.com/mcp --platform moomoo --auth moomoo

NEVER calls order place/modify/cancel/GTT tools.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Annotated

import typer
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from portfolio.logging import SecretRedactionFilter

app = typer.Typer()

# Default read-only probes (presence-dependent).
DEFAULT_TOOLS = ["get_holdings", "get_quotes", "get_user_profile", "get_positions"]


@app.command()
def probe(
    url: Annotated[str, typer.Option(help="MCP endpoint URL")],
    platform: Annotated[str, typer.Option(help="platform name -> samples/<platform>/")],
    tools: Annotated[str | None, typer.Option(help="comma-separated tools to call")] = None,
    timeout: Annotated[float, typer.Option(help="per-call timeout seconds")] = 45.0,
    auth: Annotated[str, typer.Option(help="auth mode: none | moomoo")] = "none",
) -> None:
    selected = [t.strip() for t in (tools or ",".join(DEFAULT_TOOLS)).split(",") if t.strip()]
    asyncio.run(_probe(url, platform, selected, timeout, auth))


async def _probe(url: str, platform: str, tools: list[str], timeout: float, auth: str) -> None:
    out_dir = Path("samples") / platform
    out_dir.mkdir(parents=True, exist_ok=True)
    redactor = SecretRedactionFilter()

    http_client = None
    if auth == "moomoo":
        # OAuth provider (read-only scopes) + auto-refresh httpx2 client.
        from portfolio.tokens.moomoo_oauth import (
            build_auth_provider,
            build_authenticated_client,
            verify_granted_scope,
        )

        provider = build_auth_provider()
        _last_provider = provider
        http_client = build_authenticated_client(provider)
        ok, detail = await _auth_status(provider)
        print(f"[probe] moomoo auth: {ok} - {detail}")

    async with streamable_http_client(url, http_client=http_client) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        server_info = getattr(session, "server_info", None)
        print(f"[probe] connected to {url}; server: {server_info}")

        if auth == "moomoo":
            # The initialize() above may have triggered the consent flow
            # (401 -> provider -> browser). Verify what was granted.
            provider = _last_provider
            try:
                tokens = await provider.context.storage.get_tokens()
                verify_granted_scope(tokens.scope if tokens else None)
            except Exception as exc:  # noqa: BLE001
                print(f"[probe] scope check FAILED: {exc}")

        # 1) Tool inventory
        listed = await session.list_tools()
        inventory = [
            {
                "name": t.name,
                "description": (t.description or "")[:300],
                "input_schema": getattr(t, "input_schema", None),
            }
            for t in listed.tools
        ]
        _dump(out_dir / "_tools.json", inventory, redactor)
        print(f"[probe] {len(inventory)} tools listed -> {out_dir / '_tools.json'}")

        # 2) Read-only calls
        for name in tools:
            try:
                result = await session.call_tool(name, {})
                raw = result.result if hasattr(result, "result") else result
                payload = {"tool": name, "content": raw}
                _dump(out_dir / f"{name}.json", payload, redactor)
                print(f"[probe] {name} -> {out_dir / name}.json")
            except Exception as exc:  # noqa: BLE001 - probe must not die on one tool
                _dump(out_dir / f"{name}.json", {"tool": name, "error": str(exc)}, redactor)
                print(f"[probe] {name} FAILED: {type(exc).__name__}: {exc}")


_last_provider = None


async def _auth_status(provider) -> tuple[bool, str]:
    tokens = await provider.context.storage.get_tokens()
    if tokens is None:
        return False, "no tokens stored - consent flow will start on first request"
    return True, f"token stored, scope={tokens.scope or '(unspecified)'}"


def _dump(path: Path, obj: dict, redactor: SecretRedactionFilter) -> None:
    text = json.dumps(obj, indent=2, default=str, ensure_ascii=False)
    redacted = redactor._redact(text)  # guardrail #2: scrub before saving
    path.write_text(redacted, encoding="utf-8")


if __name__ == "__main__":
    app()
