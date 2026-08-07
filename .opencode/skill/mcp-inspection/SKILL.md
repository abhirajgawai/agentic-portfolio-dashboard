---
name: mcp-inspection
description: Connect to any broker MCP server, list its tools, dump raw outputs to samples/, build a tool allowlist, and prep for normalization. Run this BEFORE writing any normalizer or pipeline client.
---

# MCP Inspection Workflow

Always inspect the real server before writing normalizers or clients. Never guess field
names from docs.

## Steps

1. **Identify the endpoint** (from PLAN.md or config):
   - Zerodha: `https://mcp.kite.trade/mcp` (hosted, streamable HTTP).
   - Moomoo: `https://mcp.moomoo.com/mcp` (OAuth; 401 unauthenticated) + our local
     OpenD wrapper (`moomoo_mcp/server.py`, stdio).
   - Groww: **no MCP exists** — the ₹499/mo Trade API is equities-only (no MF, PLAN
     §2c) and was removed; its data comes from the free CAS import (`cas_import.py`,
     MIT `casparser`) + AMFI NAV (`mf_nav.py`). Never build a Groww MCP wrapper.
2. **Connect** with the Python `mcp` SDK:
   - Remote: `StreamableHttpSession` over `httpx` (with token header if needed).
   - Local: `stdio_client` running the FastMCP server command.
3. **`list_tools()`** → save tool inventory to `samples/<platform>/_tools.json`
   (name + input schema + description).
4. **Call read-only tools only.** Suggested probes (presence-dependent):
   `get_holdings`, `get_positions`, `get_quotes`, `get_user_profile`,
   `get_orders` (read-only). NEVER call place/modify/cancel/GTT tools.
5. **Dump raw responses** to `samples/<platform>/<tool>.json`. Apply the secret
   redaction filter BEFORE saving; scrub tokens/credentials.
6. **Report** to the normalizer: tool names used, exact JSON shape (top-level keys,
   nesting), types, and which fields map to the common schema.

## Tool allowlist
Output a recommended allowlist of read-only tool names per platform. The pipeline MCP
client will be constructed with ONLY these names. Examples:

```json
{
  "zerodha": ["get_holdings", "get_positions", "get_quotes", "get_user_profile"],
  "moomoo": ["get_accounts", "get_positions", "get_funds"]
}
```

## Tests
- Assert `samples/<platform>/<tool>.json` exists and is valid JSON.
- Assert the pipeline client's exposed tool set equals the allowlist (no extras).

## Traps
- Moomoo OAuth tools may appear after auth; if tool coverage is insufficient, use the
  OpenD gateway + official SDK wrapped in a local FastMCP (`mcp-integration` agent).
- Some hosted servers return partial data for unauthenticated sessions — capture after
  auth.