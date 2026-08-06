"""MCP inspection probe (skill: mcp-inspection).

Connects to a broker MCP endpoint, lists tools, calls a set of READ-ONLY tools,
and dumps raw responses to samples/<platform>/<tool>.json with secret redaction
applied before saving.

Usage:
    uv run python scripts/probe_mcp.py --url https://mcp.kite.trade/mcp --platform zerodha
    uv run python scripts/probe_mcp.py --url https://mcp.moomoo.com/mcp --platform moomoo \
        --tools get_account_summary,get_holdings

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
) -> None:
    selected = [t.strip() for t in (tools or ",".join(DEFAULT_TOOLS)).split(",") if t.strip()]
    asyncio.run(_probe(url, platform, selected, timeout))


async def _probe(url: str, platform: str, tools: list[str], timeout: float) -> None:
    out_dir = Path("samples") / platform
    out_dir.mkdir(parents=True, exist_ok=True)
    redactor = SecretRedactionFilter()

    async with streamable_http_client(url) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        server_info = getattr(session, "server_info", None)
        print(f"[probe] connected to {url}; server: {server_info}")

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


def _dump(path: Path, obj: dict, redactor: SecretRedactionFilter) -> None:
    text = json.dumps(obj, indent=2, default=str, ensure_ascii=False)
    redacted = redactor._redact(text)  # guardrail #2: scrub before saving
    path.write_text(redacted, encoding="utf-8")


if __name__ == "__main__":
    app()
