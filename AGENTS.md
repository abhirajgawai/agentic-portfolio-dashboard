# Project Conventions — Agentic Portfolio Dashboard

Personal-use, manually-built project. **Primary goal is learning.** Read `PLAN.md`
first — it is the source of truth. Work phase by phase (M0 → M9); each phase must be
working and verified before starting the next. Do not skip ahead.

## Teaching convention — explain as you build

The user is building this to learn. Agents do not just produce code — they **teach**
the how and the why at every step. Follow this rhythm for each piece of work:

1. **Plan out loud first.** Before writing code, state: what we're about to build, why
   it's needed for this milestone, and the key concepts involved — in plain language,
   not jargon-only (e.g. "an MCP session is…", "the upsert key is… because…").
2. **Show the evidence.** When a decision comes from research (inspecting a live MCP
   server, reading upstream source), surface the finding and what it changes about the
   design. Cite the real file/URL the conclusion came from.
3. **Explain the code as you write it.** For each non-trivial module, explain its role
   in the pipeline and the interesting bits: why the tool allowlist, why the upsert is
   keyed `(run_at, platform, ticker)`, why the redaction filter lives at handler level,
   why a daemon holds the session, etc.
4. **Summarize after.** End each chunk of work with: what changed, why it's designed
   that way, the exact files to look at to learn, and what's next.
5. **Answer "why/how" generously.** When the student asks, expand with concrete examples
   from the actual code or the captured `samples/`. Assume an interested learner, not a
   professional; reach for an analogy and a one-line mechanism when useful.
6. **Never dump code without explanation.** When a full file needs to be shown, pair it
   with what each part does and why it exists.
7. **Keep the determinism boundary.** All teaching lives in the conversation and in
   docs/PLAN. It never changes the pipeline's deterministic behavior (M0–M6) or bleeds
   into the pipeline code or the agent runtime. Green light to teach does not loosen the
   non-negotiable guardrails below.

## Stack (locked)

- Pipeline / agent language: **Python** — uv project, ruff, pytest. Manage with `uv`.
- Storage: **SQLite first** (`data/portfolio.db`) → migrate to Supabase in M9.
- Q&A agent runtime (M7): **opencode server API** (`opencode serve`, HTTP + SSE).
- Alerts: **Telegram bot**.
- Dashboard: **Vite + React + TypeScript + recharts**.
- Local scheduler: **Windows Task Scheduler** (M4). Git: private repo.

## Brokers

| Platform | Geography | Integration | Auth |
|---|---|---|---|
| Zerodha | IN | hosted MCP `https://mcp.kite.trade/mcp` | MCP `login` tool, manual daily browser login |
| Groww | IN | custom FastMCP → official REST Trade API (`growwapi` SDK) | `API_AUTH_TOKEN`, manual daily login (verify lifetime) |
| Moomoo | US | OpenD gateway + `moomoo-api` SDK wrapped in our read-only FastMCP (`moomoo_mcp/`); hosted MCP `https://mcp.moomoo.com/mcp` is market-data-only (OAuth grants just `quote:read` to dynamic clients) | OpenD desktop login (manual) + trade password in `data/tokens.json` |

## Non-negotiable guardrails (enforced in code, not just policy)

1. **Two-layer tool allowlist.** Broker MCP clients expose ONLY whitelisted read-only
   tool names (e.g. `get_holdings`, never `place_order`). On the opencode agent side,
   control MCP tools via the **`tools` config + per-agent overrides** (glob patterns),
   NOT `permission` (that covers built-in tools only). Order place/modify/cancel tools
   are never referenced anywhere. Our own FastMCP wrappers never register write tools.
2. **Secrets.** Tokens live only in gitignored `data/tokens.json`. A logging
   **redaction filter** is mandatory. Snapshots/outputs contain holdings, never
   credentials. CI has a grep-guard that fails on accidental token patterns.
3. **No automated login.** Zerodha/Groww daily browser login (2FA) is manual by design
   (regulatory requirement). Do NOT build Selenium/TOTP auto-login. Detect expiry and
   notify via Telegram instead of failing silently.
4. **Determinism boundary.** M0–M6 + M8 rendering are deterministic — identical output
   for identical input. The LLM touches ONLY the M7 Q&A agent and the dashboard chat.
5. **Inspect before normalize.** Connect to an MCP server, `list_tools()`, and dump raw
   outputs to `samples/` BEFORE writing any normalizer. Pin samples for regression.

## Build order

M0 scaffold → M1 Zerodha e2e → M2 Moomoo + consolidated → M3 Groww wrapper → M4
scheduling/calendars → M5 returns/XIRR → M6 alerts → M7 Q&A agent → M8 dashboard → M9
deploy. Snapshotting starts in M1 (time-series value compounds with age).

## Verification

- `uv run ruff check .` and `uv run pytest` before declaring work done.
- **Tests are written only when they earn their place.** Do not blanket-add unit
  tests for every new function or refactor. Write a test when it guards something
  genuinely fragile (an integration boundary, a data-shape contract like a pinned
  sample, a bug we actually hit, a UNIQUE-key dedupe invariant) or when it is the
  fastest way to verify a tricky fix. Prefer running the real pipeline / CLI against
  live fixtures as the primary check; add a test only if a regression is likely or
  the logic is subtle. When a test IS needed, keep it small and targeted.
- Each milestone has a `✅ Done when:` bar in `PLAN.md` — meet it explicitly.
- Use the project agents (`.opencode/agent/`) for phase-specific work and the skills
  (`.opencode/skill/`) for phase-specific procedures. Load the matching skill before
  doing phase work.
