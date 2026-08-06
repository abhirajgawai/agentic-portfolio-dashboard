---
name: agent-guardrails
description: Configure opencode for the read-only portfolio-analyst Q&A agent — tool-allowlist via tools config (not permission), MCP wiring, OAuth, turn budget, audit. Use for M7.
---

# Agent Guardrails Skill (M7)

Configures the Q&A agent so it can analyze the portfolio but can NEVER trade.

## Key fact
**`permission` covers only built-in tools (bash, edit, webfetch). MCP tool control is
done through the `tools` config** (glob patterns) + per-agent overrides. To control a
specific MCP tool, use `nested_tools` for the outer tools, and `tools` with explicit
glob negation like `MCP-xyz*:*place*`. (Two levels of globs are supported.)

## Pattern for read-only lockdown
1. **Globally** in `opencode.json`, disable destructive broker tools:
   ```js
   "tools": {
     "kite_place_order": false,
     "kite_modify_order": false,
     "kite_cancel_order": false,
     "kite_*gtt*": false,
     "groww_*place*": false, "moomoo_*place*": false
   }
   ```
2. **Per-agent** (`portfolio-analyst`), enable ONLY the read-only allowlist via globs
   (e.g. `get_holdings*`, `get_positions*`, `get_quotes*`, `latest_snapshot`,
   `allocation_summary`, `holding_history`) and let everything else inherit the global
   deny. This creates the two-layer allowlist.
3. Verify by asking the agent to place an order — it must be refused with no tool call.

## MCP wiring (M7)
- 4 servers: `zerodha` (`mcp@https://mcp.kite.trade` stdio), `groww` (local
  `uv run groww_mcp/server.py`), `moomoo` (hosted, OAuth), `portfolio_data`
  (local, SQLite).
- Moomoo OAuth: `opencode mcp auth moomoo`. Zerodha manual daily login via
  `token-session` skill.

## Budget & control (client-side, `src/portfolio/agent/`)
- `maxTurns` from the app config (e.g. 12). Post message → stream SSE → abort via
  `POST /session/:id/abort` if budget exceeded or a timeout hits.
- Log every tool call (name, tool_calls) for the eval set and audit.

## Evaluation
- 10–15 canned questions incl. multi-hop. Assert: answers within budget; zero
  non-allowlisted selections.

## Refusals
- Any attempt to place/modify/cancel an order, run real trades, or expose secrets is
  refused. Config screams read-only.