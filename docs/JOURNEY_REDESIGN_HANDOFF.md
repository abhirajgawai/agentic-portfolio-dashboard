# Handoff: Journey Screen Redesign + Future Pages

**Written 2026-08-27, end of a Claude Code session, for whoever (OpenCode agents,
or a human) picks this up next.** This is the map, not the source of truth — the
plan and spec files it points to are. Read this first, then follow the pointers.

---

## 1. What's already done this session (all on `main`, committed)

In order, each already committed:

1. **`fix(bridge): pass --eod on on-demand snapshots`** (`src/portfolio/bridge.py`) —
   the per-platform "take snapshot now" button never wrote to `position_snapshot`
   (the table `history.json`/Account Roads is derived from), only the live
   `position` table. Root-caused and fixed; verified live.
2. **CAMS bot-detection fix** (`src/portfolio/cams_cas_request.py`, committed earlier,
   already on `main` before this session's later work) — CAMS's WAF was
   fingerprinting Playwright's headless Chromium (`navigator.webdriver`,
   `HeadlessChrome` UA string) and silently rejecting every automated CAS
   request as a fake "rate limit." Fixed by masking those two signals. Verified
   live with a real reference number returned.
3. **`CLAUDE.md`** added at repo root — guidance for Claude Code sessions,
   mirrors `AGENTS.md`'s guardrails plus lessons hit this session (the `--eod`
   gotcha above, and that the bridge process doesn't hot-reload after editing
   `bridge.py` — it must be restarted to pick up code changes).
4. **Staleness banner** (`dashboard/src/components/journey/StalenessBanner.tsx`,
   new) — flags on the Journey screen when Zerodha/Moomoo/Groww MFs/Groww
   equities/Sharekhan haven't been refreshed "today" (manual entries + Groww
   MFs) or within their existing 2-day threshold (Zerodha/Moomoo). Replaces the
   scheduled EOD/morning snapshot tasks removed from
   `scripts/scheduler/register_tasks.ps1` (the laptop isn't always on when
   markets are — snapshots are on-demand-only now, per-platform button).
5. **`AccountRoads.tsx`** — real estate removed from the platform list per user
   request (not a data source that changes daily; cluttered the roads list).
6. **Three Claude-Code-specific subagents** added at `.claude/agents/`
   (`dashboard-ui-designer.md`, `dashboard-react-engineer.md`,
   `dashboard-design-reviewer.md`) — **these are Claude Code only and won't be
   picked up by OpenCode.** See §4 below for the OpenCode-native equivalents
   that already existed in this repo before this session and should be used
   going forward instead.
7. **Full design pipeline for the Journey (landing) screen redesign**, in
   `docs/design/`:
   - `audit/2026-08-27-journey-redesign-audit.md` — root-caused why the current
     chart reads as dated/unclear (a broken, unstyled Recharts `<Brush>`
     control; a chart form that assumes dense data when this account only has
     3 real snapshots; near-invisible gradient in dark theme; teardrop pin
     milestones; imperceptible 6px entrance motion; dead CSS keyframe
     references that mean the "draw-in" animation never actually ran).
   - `directions/2026-08-27-journey-redesign-direction-{1,2,3}.md` — three
     named options ("Pulse" low-risk/no-new-deps, "Ascent" highest-ceiling
     with new deps, "Chronicle" leans into the app's story identity).
   - `selected/2026-08-27-journey-redesign-selected-direction.md` — user chose
     **"Ascent."**
   - `spec-round3/` — the full implementation-ready spec: `spec.md` (the
     primary document — read this fully before touching code),
     `tokens.json` (confirms **zero new CSS tokens** needed),
     `rationale.md` (why each non-obvious call was made),
     `accessibility/a11y-spec.md` (the authoritative 8-row reduced-motion
     table), `motion/motion-spec.md` (animation timing/character).
8. **9-task implementation plan**:
   `docs/superpowers/plans/2026-08-27-journey-redesign-ascent.md`. This is a
   Claude Code "Superpowers" plan — its header says
   `REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development`. **Ignore
   that line — it's a Claude Code skill OpenCode doesn't have.** Everything
   else in the file (Global Constraints, the 9 tasks with exact file paths,
   exact code, exact verification commands, the resolved spec conflict at the
   top) is tool-agnostic and fully usable. See §3.
9. **Task 1 of that plan is done**: `@visx/shape@^4.0.0`, `@visx/scale@^4.0.0`,
   `@visx/gradient@^4.0.0`, `d3-interpolate-path@^2.3.0` (+
   `@types/d3-interpolate-path@^2.0.3` dev), `motion@^13.1.1` are installed in
   `dashboard/` (commit `29f36c9`, already on `main`). The `motion@13.1.1` API
   was verified against its real installed type definitions (not assumed from
   illustrative spec code) — confirmed:
   - `import { useMotionValue, useSpring } from "motion"`
   - `useMotionValue<T>(initial: T): MotionValue<T>`
   - `useSpring(source: MotionValue<T> | T, options?): MotionValue<T>`
   - `.on("change", (latestValue: V) => void): VoidFunction`

   Task 6 of the plan (the spring-based `useAnimatedNumber` rewrite) can use
   these exact names directly instead of re-deriving them.

A git worktree was created for isolated implementation
(`.claude/worktrees/journey-redesign-ascent`, branch
`worktree-journey-redesign-ascent`) — **it's Claude-Code-specific tooling,
now redundant.** Task 1's commit was fast-forward-merged into `main` already,
so nothing is lost if that directory is deleted. It's gitignored
(`.claude/worktrees/` added to `.gitignore`) so it won't show up as untracked
noise in `git status`. Its `.superpowers/sdd/2026-08-27-journey-redesign-ascent/`
subdirectory holds the Claude-Code session's task ledger and review artifacts
for Task 1 only — historical reference, not needed to continue.

---

## 2. What's pending

**Tasks 2-9 of `docs/superpowers/plans/2026-08-27-journey-redesign-ascent.md`.**
One-line reminder of each (the plan file has the real detail — file paths,
exact code, exact commands):

| Task | What it does |
|---|---|
| 2 | Rebuild `JourneyChart.tsx`'s plot on `@visx` (scales, `LinePath`, `AreaClosed`, gradient) — static, no morph/glow/pulse yet. Removes `Brush`, `DayChangeStrip`, all Recharts plot components. **Read the "⚠️ Resolved spec conflict" note near the top of the plan file before starting this task** — the spec text says to remove `<ChartContainer>` entirely; that's wrong and would break Task 4. Keep it (it's a plain React context provider, not a Recharts wrapper — verified by reading `dashboard/src/components/ui/chart.tsx`). |
| 3 | Path-morph on range-pill change (`d3-interpolate-path`), shared SVG glow filter, "today" pulse ring. Also adds `SPRING_CONFIG_NUMBER`/`SPRING_CONFIG_MILESTONE_POP` to `motion.ts` — front-loaded here specifically so Task 4 (next) isn't blocked waiting for Task 6. |
| 4 | `MilestonePin.tsx` → halo dots (replaces teardrop pins), positioned via the visx scales instead of Recharts hooks. Manual tooltip wiring (pointer-move + nearest-point lookup) replacing Recharts' built-in tooltip. |
| 5 | Sparse (<8 points) vs. dense (≥8 points) chart mode split. New `DeltaChipRail.tsx` component (reuses `AccountRoads.tsx`'s number-leads chip pattern) replaces the old bar-chart day-change strip in sparse mode only. **Known integration risk, already flagged in the plan's own dispatch guidance:** changing margins between modes changes the scales' `range()`, which can silently break Task 4's tooltip math in sparse mode — re-verify the tooltip still works after this task, not just the new chip rail. |
| 6 | `animation.ts` — rewrite `useAnimatedNumber` on `motion` spring physics (using Task 1's confirmed API above). Public signature unchanged; `Headline`/`TodayPanel` need zero changes. |
| 7 | `JourneyWorkspace.tsx` entrance stagger via `motion/react`'s `<motion.div>` (replaces the old manual `setTimeout`+CSS-class `Entrance` component — its 6px rise was audit-flagged as imperceptible, becomes 12px with a real spring). `GoalMilestones.tsx` goal-crossing pop. `JourneyChart.tsx` milestone halo-dot pop (deliberately does NOT reuse `useGoalCrossing` — see the plan's rationale.md §4 for why). |
| 8 | `EmptyGlyph.tsx` (new, ~12-line inline SVG) replaces plain-text empty states in `JourneyChart.tsx` and `GoalMilestones.tsx`. |
| 9 | Full state-matrix QA (both themes, masked/unmasked, all 8 reduced-motion rows individually, sparse/dense, empty) + **required** `npm run build` bundle-size delta report against the ~20-23KB gzip estimate — the plan is explicit that this must be measured, not assumed. |

**After Task 9**, the plan's own "Handoff to review" section says to run an
independent design/QA review before merging — see §4 for which OpenCode
agent does that.

---

## 3. How to execute the remaining tasks with OpenCode

The plan file at `docs/superpowers/plans/2026-08-27-journey-redesign-ascent.md`
already has everything needed per task: exact files to touch, exact code for
the non-obvious parts, and a concrete verification command. It was written
assuming a "fresh implementer per task + review after each task" process —
that's not a Claude-Code-only idea, it's just good practice, and this repo's
own `AGENTS.md` already describes the same shape for OpenCode's own
`orchestrator`:

> "runs independent workers in parallel, and loops until the milestone's
> ✅ Done when: bar is met before advancing. It verifies results itself
> rather than trusting a worker's self-report."

**Recommended flow, task by task, in order (2 through 9 — do not reorder,
later tasks depend on earlier ones' file changes, this was verified in a
pre-flight conflict scan before Task 1 started — see
`.claude/worktrees/journey-redesign-ascent/.superpowers/sdd/2026-08-27-journey-redesign-ascent/progress.md`
if you want that scan's full reasoning):**

1. Give the `orchestrator` (or `dashboard-builder` directly, if working
   task-by-task without the full orchestrator loop) the specific task's
   section from the plan file — not the whole plan, just that task's `###
   Task N: ...` block through its steps and commit message. The plan file's
   own task boundaries are already sized for this.
2. `dashboard-builder` implements, runs the task's own verification commands
   (`npm run typecheck && npm run lint`, plus whatever manual browser check
   the task specifies), commits with the message the plan gives.
3. `code-reviewer` reviews that task's diff against the task's own
   requirements (spec compliance) and general code quality — same two-part
   verdict this repo's `AGENTS.md` already describes for `code-reviewer`
   ("independent review of plans/code/diffs — structure, logic, security,
   guardrail compliance").
4. Fix any findings, re-verify, move to the next task.

One real thing to watch for, learned this session: **a finding isn't
automatically correct just because a reviewer raised it.** During Task 1's
review, a reviewer flagged `recharts` as an "undocumented dependency added" —
turned out to be a false positive (recharts was already a dependency;
`npm install` just alphabetically re-sorted `package.json`, which shifted
that line in the diff without changing its content). Verify a flagged
finding against the actual base-vs-head diff before treating it as real,
especially for anything touching `package.json`/lockfiles after an
`npm install`.

---

## 4. OpenCode's own design/build agents — use these, not the Claude-Code ones

This repo already has a matching design→build→review pipeline in
`.opencode/agent/` (per `AGENTS.md`'s agent topology table), predating this
session's Claude-Code-specific mirrors:

| OpenCode agent | Role |
|---|---|
| `orchestrator` | Default/primary — decomposes work, delegates, parallelizes independent items, verifies before advancing |
| `ui-designer` | Design audit → directions → spec handoff (**this is who produced everything in `docs/design/` this session** — Claude Code's `dashboard-ui-designer` was a stand-in used only because OpenCode wasn't the active tool this session) |
| `dashboard-builder` | Implements a design spec into the actual dashboard |
| `code-reviewer` | Independent review at milestone gates |

**Use `ui-designer` → `dashboard-builder` → `code-reviewer` for everything
from here on**, both for finishing the Journey redesign (§3) and for the
other workspaces later (§5). The three Claude-Code-only subagents at
`.claude/agents/` can stay in the repo (harmless, they just won't be picked
up by OpenCode) or be deleted — your call, they're not load-bearing for
anything.

---

## 5. Rules that apply to ALL of this — Journey finish, and every future page

From `AGENTS.md` / `CLAUDE.md` (already in the repo, read those directly for
the complete list) — the ones most relevant to dashboard redesign work
specifically:

1. **`dashboard/src/types/contract.ts` is immutable.** Never add/rename a
   field to make a design easier to build. If a design needs data the
   contract doesn't have, that's a blocked dependency to flag, not something
   to route around.
2. **Determinism boundary.** Every workspace except the chat drawer renders
   purely from the static JSON contract — never wire a data-rendering screen
   to the LLM agent (`/api/ask`).
3. **Zero new CSS custom properties** unless a design doc's own `tokens.json`
   explicitly says otherwise and states why. Reuse the existing OKLCH tokens
   in `dashboard/src/index.css`.
4. **Both light and dark themes, always** — verify every visual change in
   both, not just the one you happened to be looking at.
5. **Privacy mask** (`usePrivacy()`/`MASK_TEXT`) gates every money value,
   everywhere, no exceptions.
6. **`prefers-reduced-motion: reduce`** must independently gate every new
   animation/transition — never one top-level switch that could accidentally
   miss disabling one interaction.
7. **The bridge process does not hot-reload** — if you edit `bridge.py` and
   need to test against a running dev stack, restart it
   (`python -m portfolio.bridge`).
8. **Verification bar before calling anything done:** `npm run typecheck &&
   npm run lint` (from `dashboard/`), plus `npm run check:contract` if
   anything touching the JSON contract changed, plus an actual look at the
   running app — start `npm run dev`, navigate to the changed screen, check
   both themes. A change "verified" only by reading the diff has, more than
   once this session, turned out to be wrong in ways only the running app
   revealed (a stale-looking banner because the bridge process hadn't
   restarted; a chart that "looked right" in code but rendered a broken
   Brush control in the browser).
9. **Before any commit:** `git status` and confirm nothing under `data/`,
   `dashboard/public/data/`, or an authenticated `samples/*_authed.json` is
   staged (guardrail #3, both `AGENTS.md` and `CLAUDE.md`).

---

## 6. Planning future pages (after Journey ships)

The user's explicit direction: **Journey (landing) screen first, then the
rest of the pages later, one at a time** — not a simultaneous full-app
re-theme. When that time comes, for each remaining workspace (Portfolio,
Allocation, Alerts, Properties, Groww/Sharekhan Data):

1. **Follow the exact same pipeline** this session established and that
   `docs/design/` already has four rounds of precedent for: `ui-designer`
   produces an audit (`docs/design/audit/YYYY-MM-DD-<slug>-audit.md`) of that
   specific workspace's actual current code + live rendering (both themes),
   then 2-3 named directions (`docs/design/directions/`), stop there and let
   the user pick, then `ui-designer` produces the selection doc + full spec
   (`docs/design/selected/`, `docs/design/spec-<round>/`) only after a
   direction is chosen — do not skip straight to a spec without the user
   choosing a direction first, same as this round.
2. **Scope each round to one workspace.** Don't let a "Portfolio redesign"
   spec quietly start touching Allocation's shared components without saying
   so explicitly in the spec's own scope section.
3. **`dashboard-builder` builds from the spec** (via `writing-plans`-style
   task breakdown if the spec is large enough to warrant it, the way this
   Journey round did — the round-3 spec was big enough to earn its own
   9-task plan; a smaller workspace tweak may not need one).
4. **`code-reviewer` (or a dedicated design-fidelity pass) verifies against
   the spec** before calling a round done — spec compliance AND this repo's
   non-negotiables (§5 above), driving the actual running app, not just
   reading the diff.
5. **Reuse tokens/components across rounds.** By the time all workspaces are
   redesigned, they should read as one coherent system, not five unrelated
   passes — check `docs/design/spec-round3/tokens.json`'s "zero new tokens"
   discipline before introducing yet another one-off value.

---

## 7. If something's unclear

- The Journey spec's own **Open Dependencies** section (`spec.md`, near the
  end) lists what was left for implementation-time verification — Task 1
  already resolved the `motion` API item (§1.9 above); the bundle-size
  measurement (Task 9) is still open by design.
- The plan's **pre-flight conflict-scan table** (in the SDD ledger,
  `.claude/worktrees/journey-redesign-ascent/.superpowers/sdd/2026-08-27-journey-redesign-ascent/progress.md`)
  has the reasoning behind every task's ordering, in case a task needs
  re-sequencing for some reason not anticipated here.
- `PLAN.md` at the repo root remains the overall project's source of truth
  for anything outside this specific redesign.
