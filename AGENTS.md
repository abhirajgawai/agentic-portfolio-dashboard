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
| Groww | IN | **free CAS import** — monthly Consolidated Account Statement parsed by MIT `casparser` (`portfolio cas import`) + AMFI NAV (`mf_nav.py`); the ₹499/mo Trade API is equities-only (no MF) and was REMOVED (PLAN §2c) | none (email/OTP statement + keyless AMFI feed) |
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
3. **No automated login.** Zerodha daily browser login (2FA) is manual by design
   (regulatory requirement). Do NOT build Selenium/TOTP auto-login. Detect expiry and
   notify via Telegram instead of failing silently. (Groww needs no login — its data
   comes from the emailed CAS + the keyless AMFI feed.)
4. **Determinism boundary.** M0–M6 + M8 rendering are deterministic — identical output
   for identical input. The LLM touches ONLY the M7 Q&A agent and the dashboard chat.
5. **Inspect before normalize.** Connect to an MCP server, `list_tools()`, and dump raw
   outputs to `samples/` BEFORE writing any normalizer. Pin samples for regression.

## Build order

M0 scaffold → M1 Zerodha e2e → M2 Moomoo + consolidated → M3 Groww via free CAS import
→ M4 scheduling/calendars → M5 returns/XIRR → M6 alerts → M7 Q&A agent → M8 dashboard →
M9 deploy. Snapshotting starts in M1 (time-series value compounds with age).

## Agent topology — orchestrator + workers

The default agent is the **orchestrator** (`.opencode/agent/orchestrator.md`), a
conductor that decomposes a goal into milestone work items, delegates each to a
specialist **worker subagent**, runs independent workers **in parallel**, and **loops**
until the milestone's `✅ Done when:` bar is met before advancing. It verifies results
itself rather than trusting a worker's self-report. **Parallelism is the default for
EVERY task, not just milestones** — any goal with 2+ independent deliverables is
decomposed and fanned out concurrently; sequential execution happens only under a hard
dependency (same-file writes, inspect-before-normalize, milestone gates).

| Agent | Mode | Owns |
|---|---|---|
| `orchestrator` | primary (default) | Plan, decompose, delegate, parallelize, verify, loop |
| `pipeline-builder` | subagent | M0–M6 deterministic pipeline |
| `mcp-integration` | subagent | MCP connect/inspect, `samples/` capture, FastMCP wrappers |
| `normalizer` | subagent | raw sample → common schema, FX/consolidation helpers |
| `agent-runtime` | subagent | M7 Q&A agent layer |
| `dashboard-builder` | subagent | M8 dashboard + M8.5 revamp implementation |
| `ui-designer` | subagent | Dashboard UX/UI design: audit → design directions (user picks) → spec package (`docs/design/spec/`) → hands off to `dashboard-builder`; reviews implementation for design fidelity |
| `deployer` | subagent | M9 deployment |
| `code-reviewer` | all | independent review of plans/code/diffs — structure, logic, security, guardrail compliance, AI-slop cleanup; verdict at milestone gates |

Rules of the topology:
- **Parallelize by default, decompose everything — automatically.** Any task — a
  milestone, a feature, a bug fix, a config change — is first decomposed into its
  smallest independently-finishable work items, then the parallel frontier is fanned
  out in one message. No agent ever waits to be told to parallelize or asks whether
  parallel work is wanted; it is the unconditional default for every task. Workers
  also decompose their own briefs (parallel `explore` probes, per-platform
  normalizers) and run independent sub-units concurrently. Sequential execution is the
  exception, justified only by a hard dependency.
- **Permission is ALLOW everywhere by design.** No agent or session ever waits on a
  permission prompt — parallel fan-outs must not stall. The safety boundary is the
  **`tools` allowlist** (glob denials + per-agent overrides, guardrail #1), which is a
  hard deny, never a prompt. Never reintroduce `permission: ask`/`deny` to "fix"
  safety — tighten the allowlist instead. The `portfolio-analyst` agent's read-only
  tool set stays as-is (its deny list is the guardrail, not a prompt).
- **Parallelize within a milestone, never across milestones.** Build order stays a hard
  gate; the orchestrator advances sequentially and parallelizes independent items inside
  the current milestone.
- **Inspect before normalize** still holds: `mcp-integration` captures a platform's raw
  sample before its `normalizer` runs — never in parallel for the same platform.
- `subagent_depth` is 2, so `pipeline-builder` may itself delegate to
  `normalizer`/`mcp-integration`.
- The orchestration playbook lives in the `orchestration` skill; load it before delegating.
- Guardrails below apply to every agent at every level; no delegation loosens them.

## Verification

- **Before any commit, check `.gitignore` is updated.** Run `git status` and
  confirm nothing personal or stray would be pushed: `data/tokens.json`,
  `data/*.db*`, `data/logs/`, `data/cas/`, `data/properties/`,
  `dashboard/public/data/`, authed samples, and botched artifacts like
  `dashboard/@/`. If new data files are created by a feature, add them to
  `.gitignore` FIRST (guardrail #2 — never commit credentials, addresses, PANs,
  or live portfolio values). Only then stage intended files explicitly.
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
