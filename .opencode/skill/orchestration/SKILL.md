---
name: orchestration
description: How the orchestrator decomposes a goal into milestone work items, runs independent worker subagents in parallel, and loops until each milestone's Done-when bar is met. Use whenever planning or delegating multi-step project work, or when a task spans more than one worker agent.
---

# Orchestration Skill

The orchestrator conducts specialist workers. It wins by **decomposing well, parallelizing
safely, and verifying relentlessly** — not by writing code itself.

## Core loop
```
Orient (PLAN.md + repo state)
  -> Plan out loud + todowrite
  -> Find independent work items (the parallel frontier)
  -> Delegate: one `task` call per item, ALL independent calls in ONE message
  -> Collect results + verify against the milestone's "Done when" bar
  -> Not met? re-delegate with a fix brief. Met? advance to next milestone.
  -> Summarize (what / why / files to study / next)
```

## Orient — know where you are before delegating
- Read `PLAN.md` markers (some milestones say `DONE <date>`). Confirm with evidence:
  `git log --oneline`, file presence under `src/portfolio/`, `uv run pytest`.
- Current frontier as of this writing: M0–M3 DONE (M3 = Groww free CAS import,
  verified against the real June 2026 statement), M4+ pending. Check `PLAN.md`
  markers + `uv run pytest`; verify live before assuming. Never start M_{n+1} until
  M_n's bar is met.

## Decompose — heuristics
- One work item = one clear deliverable one worker can finish and verify on its own.
- Split by **module/file boundary**, not by "step". Two items touching the same file are
  a dependency, not a parallel pair.
- Always separate **inspect** (`mcp-integration`, writes `samples/`) from **normalize**
  (`normalizer`, reads `samples/`) — that ordering is the inspect-before-normalize guardrail.

## Parallelize — what's safe
| Safe to run together | Must serialize |
|---|---|
| Different modules/files (e.g. `fx.py` vs `calendars.py`) | Two workers editing the same file |
| Multiple `explore` read-only searches | inspect + normalize for the *same* platform |
| Research (`general`) + a code worker in another area | Anything across milestone boundaries |
| Per-platform normalizers once samples exist | DB schema migration + a worker writing to that DB |

Mechanics: issue every independent `task` call **in a single assistant message**; opencode
runs them concurrently. Dependent items wait for the next loop iteration.

## Delegate — a brief must be self-contained
Workers start with NO shared context. Every `task` prompt carries:
1. **Role** — which worker and its scope.
2. **Context** — milestone, what's already done, exact files/samples to read.
3. **Task** — one deliverable.
4. **Constraints** — guardrails, determinism, read-only, no-secrets.
5. **Verify** — the exact command + pass criteria (`uv run pytest tests/test_x.py`).
6. **Report back** — files changed, what was built, verification pass/fail + key numbers,
   blockers/decisions for the orchestrator.

## Verify — trust nothing, run the check
- After each batch, run the real gate yourself: `uv run ruff check .`, `uv run pytest`,
  or the relevant CLI (`uv run portfolio snapshot --all`, etc.).
- Compare against the milestone's `✅ Done when:` bar in `PLAN.md`. A worker saying "done"
  is a claim, not proof.

## Loop — re-delegate, don't rewrite
- On failure, send a **fix brief**: what failed, the exact error text, the minimal change.
  Keep the same worker (it has the context) via a follow-up `task` with the returned id.
- Cap retries: if the same item fails ~3 times, stop, re-scope it, or escalate to the user.

## Anti-patterns (do not)
- Don't parallelize across milestones (build order is a hard gate).
- Don't let two workers write one file.
- Don't skip verification and advance on a worker's self-report.
- Don't loosen a guardrail to unblock a milestone — pick a compliant path.
- Don't write implementation code in the orchestrator when a worker owns it.

## Example — parallelizing M3 (Groww CAS import)
```
Batch 1 (parallel):
  task(mcp-integration): confirm CAS fixture present in samples/cas/, report shape
  task(explore): list existing cas_import.py + mf_nav.py entry points and CLI wiring
Batch 2 (after Batch 1, parallel):
  task(normalizer): map CAS JSON -> common schema for MF rows, fixture test
  task(pipeline-builder): wire `portfolio cas import` + trades write, run pytest
Verify: uv run pytest; import reconciles the statement totals (68 positions,
₹66.06L across zerodha + moomoo + groww/sharekhan CAS).
```
