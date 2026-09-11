# Ledger Gold Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> to implement this plan task-by-task. Dispatch this repo's own specialized agents —
> `dashboard-react-engineer` for every build task, `dashboard-design-reviewer` for the
> QA task — not generic agents; they already know this repo's stack, verification
> commands, and screenshot-review workflow. Steps use checkbox (`- [ ]`) syntax for
> tracking. Update the checkboxes in this file itself as tasks complete — this file
> IS the overnight progress log; there is no separate log file.

**Goal:** Redesign all 6 dashboard workspaces (Journey, Allocation, Portfolio,
Alerts, Properties, Groww/Sharekhan Data) into the approved "Ledger Gold" visual
system — light mode only, dark mode is a deferred fast-follow — including a real
information-architecture change (nav simplified to 4 primary tabs + a secondary
"Manage" entry for Properties/Groww-Sharekhan Data) and a restyle (not rebuild) of
the Journey chart.

**Architecture:** Token-level work is nearly done already (existing `index.css`
values already match the approved mockup — see tokens doc). This plan is a
component/layout pass: rebuild each workspace's composition and card structure to
use real `Card` containers, the established shadow/spacing scale, and the nav
restructure, while reusing existing data hooks (`lib/data.ts`), the contract
(`types/contract.ts`), and the existing chart's `@visx` technical foundation
unchanged.

**Tech Stack:** Vite 8, React 19.2, TypeScript strict, Tailwind v4 (CSS-first
tokens in `index.css`), shadcn/ui v4 New York, TanStack Query, Zod v4, `@visx`
(Journey chart), ECharts (donuts/segments — see `lib/charts.ts`).

**Spec:** `docs/superpowers/specs/2026-09-12-ledger-gold-redesign-design.md`
(design brief — read first, has the full rationale for every IA decision below)
and `docs/design/spec-ledger-gold/tokens.md` (exact token names to use — this plan
does not repeat hex values, it cites `var(--token)` names from that file).

## Global Constraints

- Light mode (`:root`) only. Never edit the `.dark {}` block in `index.css` — dark
  mode is explicitly out of scope this pass (design brief §1).
- Zero changes to `dashboard/src/types/contract.ts`, any Python file, or
  `scripts/export_json.py` (design brief §1) — this is a frontend component/layout
  pass only.
- `WorkspaceId` union and `useWorkspace` hook's public shape are unchanged — all 6
  workspaces stay independently routable; only nav *presentation* changes (design
  brief §3).
- One new design token only: `--chart-journey` (aliased to `var(--primary)`),
  added to `index.css` `:root` and `@theme inline` blocks (tokens.md "Known gap").
  No other new CSS custom properties without flagging it back in this plan's
  progress notes first.
- Every task ends with: `npm run typecheck`, `npm run lint`, `npm run
  check:contract` all passing, plus a live-browser screenshot check via the
  `run-dashboard` skill compared against the relevant mockup screenshot from the
  session (paths noted per task below). This repo's convention (per `CLAUDE.md` /
  `AGENTS.md`) is deliberate, targeted tests over default unit-test coverage — for
  a visual/layout pass, typecheck + lint + contract-check + visual screenshot
  review over the real running app IS the test suite; do not add unit/snapshot
  tests for CSS/layout unless a task explicitly says to.
- Commit at the end of every task (local branch `redesign/ledger-gold`, never
  pushed). Use a `feat(dashboard):` or `refactor(dashboard):` prefix matching this
  repo's existing commit style (see `git log --oneline -10` for examples).
- No `git push`. No PR. No merge to `main`. Confirm current branch is
  `redesign/ledger-gold` before every commit (`git branch --show-current`).

---

## Task 0: Design token + shared primitives

**Files:**
- Modify: `dashboard/src/index.css` (add `--chart-journey` token)
- Create: `dashboard/src/components/layout/PageHeader.tsx` (shared page title +
  subtitle component, used by every workspace — mockup pattern: small muted
  eyebrow-free title, e.g. "Allocation" as a real `<h1>`, plain sentence-case
  subtitle beneath, no ALL-CAPS label per this repo's `frontend-design` skill
  guidance already internalized in the mockup)
- Modify: `dashboard/src/components/layout/Header.tsx` (nav restructure)
- Create: `dashboard/src/components/layout/ManageMenu.tsx` (the secondary
  Properties/Groww-Sharekhan Data dropdown, design brief §3)

**Interfaces:**
- Produces: `<PageHeader title="Allocation" subtitle="How ₹1.03Cr is spread..." />`
  — every later task's workspace root uses this instead of ad hoc `<h1>` markup.
- Produces: `ManageMenu` renders a small icon-button (e.g. `Settings` or
  `LayoutGrid` from `lucide-react`, matching the existing icon-button sizing in
  `Header.tsx`'s action cluster) that opens a `DropdownMenu` (shadcn/ui — install
  via `npx shadcn@latest add dropdown-menu` in `dashboard/` if not already present;
  check `dashboard/src/components/ui/` first) with two items: "Properties" and
  "Groww/Sharekhan Data", each calling the same `onWorkspaceChange(id)` prop
  `Header.tsx` already receives.
- Consumes: `WORKSPACES` from `lib/workspaces.ts` (unchanged) — `Header.tsx` now
  renders only the 4 entries whose `id` is in
  `['journey','allocation','portfolio','alerts']` as pill tabs, and passes the
  other 2 (`'properties'`, `'groww-sharekhan'`) to `ManageMenu`. Do not filter
  `WORKSPACES` itself (other code, e.g. a command bar, may read the full list per
  the file's own header comment) — filter only inside `Header.tsx`'s render.

- [ ] **Step 1: Add the `--chart-journey` token**

  In `dashboard/src/index.css`, `:root` block, add near the other `--chart-*`
  tokens (after `--chart-9`):
  ```css
  --chart-journey: var(--primary);
  ```
  In `.dark {}` block, add the same line (an alias, not a new dark-mode design —
  keeps the token defined in both themes so no component needs a themed branch
  later, per tokens.md).
  In the `@theme inline {}` block, add after the other `--color-chart-*` lines:
  ```css
  --color-chart-journey: var(--chart-journey);
  ```

- [ ] **Step 2: Verify the token resolves**

  Run `cd dashboard && npm run dev`, open the app, in devtools console run
  `getComputedStyle(document.documentElement).getPropertyValue('--chart-journey')`
  — expect it to resolve to the same value as `--primary`.

- [ ] **Step 3: Build `PageHeader.tsx`**

  ```tsx
  // dashboard/src/components/layout/PageHeader.tsx
  export function PageHeader({
    title,
    subtitle,
    actions,
  }: {
    title: string
    subtitle?: string
    actions?: React.ReactNode
  }) {
    return (
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    )
  }
  ```
  (Sizing/spacing values here are a starting point — adjust to match the mockup's
  visual rhythm once placed in a real page in later tasks; this component's job is
  consistency across pages, not pixel-perfection in isolation.)

- [ ] **Step 4: Restructure `Header.tsx` nav + add `ManageMenu`**

  In `Header.tsx`, change the `WORKSPACES.map(...)` block (lines ~101-118) to map
  over `WORKSPACES.filter(w => ['journey','allocation','portfolio','alerts'].includes(w.id))`
  only. After the existing nav `<div>`, before the theme-toggle divider, insert
  `<ManageMenu workspace={workspace} onWorkspaceChange={onWorkspaceChange} />`
  where `ManageMenu` renders the properties/groww-sharekhan items as a
  `DropdownMenu`, visually styled as a plain icon-button consistent with the
  existing Refresh/Chat/Privacy buttons in the action cluster (same `Button
  variant="ghost" size="sm"` pattern already in this file).

  Keep the pill-tab visual styling from the current file (`bg-muted/50` track,
  active tab `bg-background shadow-sm`) — restyle the *colors* to Ledger Gold in
  a later pass only if it doesn't already read correctly against the new
  `--background`; the structural pattern (segmented pill control) is already
  right and matches the mockup's nav.

- [ ] **Step 5: Verify + commit**

  ```bash
  cd dashboard && npm run typecheck && npm run lint
  ```
  Both must pass with zero new errors (compare against the pre-existing baseline
  noted in the `run-dashboard` skill — ~10 pre-existing errors in
  `components/segments/` and `chart-legend.tsx` are not yours to fix in this task).
  Screenshot the header via `run-dashboard` skill (navigate to `127.0.0.1:5173`,
  screenshot) — visually confirm 4 primary tabs + a Manage icon-button, Properties
  and Groww/Sharekhan Data no longer inline in the main tab row.

  ```bash
  git add dashboard/src/index.css dashboard/src/components/layout/PageHeader.tsx \
          dashboard/src/components/layout/Header.tsx \
          dashboard/src/components/layout/ManageMenu.tsx
  git commit -m "feat(dashboard): Ledger Gold nav restructure + chart-journey token"
  ```

---

## Task 1: Journey workspace redesign

**Files:**
- Modify: `dashboard/src/components/workspaces/JourneyWorkspace.tsx` (layout —
  confirm exact path via `Glob dashboard/src/components/**/JourneyWorkspace.tsx`
  first; `WorkspaceCenter.tsx` imports it from `@/components/workspaces/
  JourneyWorkspace`, which differs from the `journey/` directory surveyed earlier
  — resolve this path discrepancy as the first exploration step, don't assume)
- Modify: `dashboard/src/components/journey/JourneyChart.tsx` (restyle only —
  design brief §4)
- Modify: `dashboard/src/components/journey/StalenessBanner.tsx` (condense to a
  dismissible/linking chip — design brief §3.1)
- Modify: `dashboard/src/components/journey/AccountRoads.tsx` (add a `variant:
  'condensed' | 'full'` prop — Journey uses `condensed`, Allocation in Task 2 uses
  `full`; do not fork into two files, one component two render modes, since the
  row data/logic is identical and only the presentation differs)
- Modify: `dashboard/src/components/journey/TodayPanel.tsx`,
  `MilestonePin.tsx`, `GoalMilestones.tsx`, `MilestoneJournal.tsx`,
  `LiveJobsRow.tsx`, `YearStrip.tsx`, `EmptyGlyph.tsx`, `DeltaChipRail.tsx` —
  restyle pass only (Card wrappers, spacing, typography) unless a file is
  genuinely dead code after the layout change (check usage via grep before
  deleting anything).

**Interfaces:**
- Consumes: `PageHeader` (Task 0), `--chart-journey` token (Task 0).
- Consumes: `useLatest()` from `lib/data.ts` (unchanged — this task reads the same
  data the current Journey workspace already reads; do not add new hooks).
- Produces: `AccountRoads` gains `variant` prop — Task 2 depends on this exact
  prop name and the `'full'` value rendering the same rows with no truncation.

- [ ] **Step 1: Resolve the actual JourneyWorkspace file path and read it fully**

  `WorkspaceCenter.tsx` imports from `@/components/workspaces/JourneyWorkspace`.
  Read that file end to end before changing anything — do not assume its current
  structure matches the `journey/` directory file list from the design brief's
  exploration; reconcile any discrepancy and note it in the commit message if the
  actual structure differs from what §3.1 of the design brief assumed.

- [ ] **Step 2: Restructure the page layout to match the approved mockup**

  Reference: mockup screenshot `screenshot-1789140356435-0.jpg` (Ledger Gold
  Journey — this exact file is the visual target, not an approximation) plus
  design brief §3.1 for the *content* changes beyond pure visual match:
  - Hero: net-worth figure in `.font-headline` (Fraunces), live-sync status as
    small pill chips (not raw text rows) — mockup's exact treatment.
  - Staleness: replace the current full-detail warning box with a compact chip
    (e.g. "3 sources need attention →") that calls `onWorkspaceChange('alerts')`
    — the prop is already threaded through `AppShell`/`WorkspaceCenter` per the
    existing wiring; `JourneyWorkspace` needs this callback passed down from
    `WorkspaceCenter` if it doesn't already receive one (check props first).
  - Chart card: real `Card` wrapper, shadow-md, matches mockup's card padding.
  - Account snapshot: `<AccountRoads variant="condensed" />` (max 4 rows visible,
    matches mockup's right-rail card).
  - Goals/milestones: stay on this page (design brief §3.1), restyled to Card
    system.
  - Overall grid: two-column (`1fr 340px`-ish, matching mockup) on desktop,
    stacks on narrow viewports — check existing responsive conventions in the
    file before introducing new breakpoint values.

- [ ] **Step 3: Restyle `JourneyChart.tsx` (visual only — see design brief §4 for
  why this is not a technical rebuild)**

  - Area gradient stops: change color references to `var(--chart-journey)`
    (Task 0's new token), raise peak opacity so the fill reads as a real wash in
    light mode (current file's exact opacity values — read them first, this is a
    tuning change not a rewrite).
  - Line stroke: `var(--chart-journey)`, confirm `strokeWidth` and line-cap
    values match the mockup's visual weight (~2.5px, round caps — read the
    mockup SVG in `journey-mockup.html` if still present in the scratchpad, or
    the screenshot, for the target look).
  - Gridlines: `var(--border)`, confirm dash pattern isn't denser than the
    mockup.
  - Milestone dots / today-pulse: recolor from whatever token they currently
    reference to `var(--chart-journey)` / `var(--chart-3)` per the existing
    `MilestonePin.tsx` convention — do not touch the glow-filter mechanism
    itself (design brief §4 — restyle colors, keep the `@visx` technical
    implementation).
  - Tooltip: restyle via existing `ChartTooltipContent` props (background,
    border, shadow to match new Card system) — do not change its positioning
    logic.

- [ ] **Step 4: Verify + screenshot compare**

  ```bash
  cd dashboard && npm run typecheck && npm run lint && npm run check:contract
  ```
  Use the `run-dashboard` skill to screenshot the live Journey page (light mode
  — confirm `theme` is `light` via the Header's theme toggle before screenshotting,
  the app may default to dark or system). Compare side-by-side against
  `screenshot-1789140356435-0.jpg`. Note any deliberate deviations (real data vs.
  mockup's example numbers is expected and fine; layout/color/spacing should
  match closely).

- [ ] **Step 5: Commit**

  ```bash
  git add dashboard/src/components/workspaces/JourneyWorkspace.tsx \
          dashboard/src/components/journey/
  git commit -m "feat(dashboard): Ledger Gold Journey workspace redesign"
  ```

---

## Task 2: Allocation workspace redesign (+ promoted Account Roads)

**Files:**
- Modify: `dashboard/src/components/overview/AllocationScreen.tsx`
- Modify: `dashboard/src/components/overview/AllocationDonuts.tsx`
- Reuse: `dashboard/src/components/journey/AccountRoads.tsx` with
  `variant="full"` (Task 1 dependency — confirm that prop exists before starting
  this task; if Task 1 hasn't landed yet in execution order, do not duplicate the
  component, wait for it or build the prop here and let Task 1 consume it instead
  — whichever task runs second adds the prop, the plan doesn't hard-require Task 1
  before Task 2, but the two must not both independently invent a `variant`-like
  prop with different names)

**Interfaces:**
- Consumes: `AccountRoads` with `variant="full"` (see Task 1's Interfaces block
  for the exact prop contract).
- Consumes: `useLatest()` / whatever hook `AllocationScreen.tsx` currently uses
  for its donut data (read the file first — do not assume `lib/data.ts`'s exact
  export names without checking).

- [ ] **Step 1: Read `AllocationScreen.tsx` and `AllocationDonuts.tsx` fully**

  Understand current data flow (asset class / platform / geography breakdown —
  design brief §3.2 assumes these three donuts already exist in some form per the
  earlier mockup's content, which was modeled on real app content — confirm this
  assumption against the actual file).

- [ ] **Step 2: Restyle donuts to Ledger Gold + add "Platform breakdown" bars section**

  Reference mockup screenshots `screenshot-1789140902965-1.jpg` and
  `screenshot-1789140914643-2.jpg` (top portion — Allocation page). Three donut
  cards in a row (asset class / platform / geography), each a real `Card` with
  legend rows beside the donut. Below: a horizontal-bar breakdown card. Keep the
  existing ECharts-based rendering approach (design brief §5 — do not introduce a
  new charting library for donuts); restyle colors/card treatment only unless the
  current donut implementation genuinely cannot take a legend-beside-chart layout,
  in which case note the constraint and do the closest achievable layout.

- [ ] **Step 3: Add the promoted Account Roads section**

  Below the existing donut/bar content, add `<AccountRoads variant="full" />` in
  its own `PageHeader`-titled section ("Account roads" — matches Journey's
  existing heading text for continuity) or integrate into the existing bars card
  if that reads better — use judgment, the mockup's specific two-block layout
  (`donut-grid` + `bars` card) is a starting point, not a rigid requirement, since
  the "full" Account Roads content wasn't in the original mockup (that was a
  design-brief-driven addition made after the mockup review).

- [ ] **Step 4: Verify + screenshot compare + commit**

  Same verification pattern as Task 1 Step 4/5. Compare against the mockup
  screenshots noted above for the donut/bars portion (the promoted Account Roads
  section has no mockup reference — use the Journey mockup's own Account Roads
  card styling as the visual reference for consistency instead).

  ```bash
  git add dashboard/src/components/overview/AllocationScreen.tsx \
          dashboard/src/components/overview/AllocationDonuts.tsx \
          dashboard/src/components/journey/AccountRoads.tsx
  git commit -m "feat(dashboard): Ledger Gold Allocation workspace + promoted Account Roads"
  ```

---

## Task 3: Portfolio workspace redesign (+ search/sort/group + Real Estate chip)

**Files:**
- Modify: `dashboard/src/components/portfolio/PortfolioScreen.tsx`
- Modify: `dashboard/src/components/holdings/HoldingsTable.tsx`
- Read (data source, do not modify data model): `dashboard/src/components/
  holdings/PropertiesScreen.tsx` — this task only renders Properties' existing
  data inline via a filter chip (design brief §3.3), it does not change how
  Properties data is fetched/stored.

**Interfaces:**
- Consumes: whatever hook `PropertiesScreen.tsx` uses for real-estate rows —
  identify it by reading that file, then reuse the same hook in
  `PortfolioScreen.tsx` for the Real Estate chip's data (read-only reuse, same
  hook, two consumers — do not duplicate fetch logic).

- [ ] **Step 1: Read `PortfolioScreen.tsx`, `HoldingsTable.tsx`,
  `PropertiesScreen.tsx` fully**

  Identify: current filter-chip mechanism (platform chips — Groww/Moomoo/
  Zerodha/Sharekhan), current table columns, current sort/search state (if any
  already exists partially — don't assume it's fully absent).

- [ ] **Step 2: Restyle table + filter chips to Ledger Gold**

  Reference mockup screenshots `screenshot-1789140914643-2.jpg` (bottom portion)
  and `screenshot-1789140965750-7.jpg`-equivalent for the Ledger Gold variant —
  actually the saved Portfolio-page screenshot for Option A is
  `screenshot-1789140914643-2.jpg`'s Portfolio section. Card-wrapped table,
  pill filter chips (active = solid, matches mockup), instrument name + platform
  sub-label two-line cell pattern, right-aligned numeric columns with
  `tabular-nums` (already a global utility class in `index.css` — use it).

- [ ] **Step 3: Add search input, sort, group-by-platform toggle (design brief §3.3)**

  - Search: shadcn `Input` (already installed, confirmed in `ui/` listing) above
    the table, filters rows by instrument name (client-side `.filter()` on
    already-loaded holdings — no new API call).
  - Sort: clickable column headers (Value / Day / P&L at minimum) toggling
    ascending/descending, plain `useState<{key, dir}>` — no new dependency needed.
  - Group-by-platform: a `Toggle` (shadcn, already installed per `ui/` listing)
    that switches the table between flat and platform-grouped rendering (grouped
    = a sub-header row per platform, rows nested under it).

- [ ] **Step 4: Add the Real Estate filter chip**

  New chip alongside the existing platform chips. When active, renders
  Properties' rows inline using the same table structure (read-only — no edit
  affordances in this table, editing stays on the Properties workspace per
  design brief §3.5). If a property row's shape doesn't map cleanly onto the
  holdings table's columns (e.g. no "quantity"/"LTP" concept for real estate),
  adapt those cells sensibly (e.g. "1 property" instead of a share count, "—"
  for LTP) rather than forcing a fit — note the adaptation in the commit message.

- [ ] **Step 5: Verify + screenshot compare + commit**

  ```bash
  cd dashboard && npm run typecheck && npm run lint && npm run check:contract
  git add dashboard/src/components/portfolio/PortfolioScreen.tsx \
          dashboard/src/components/holdings/HoldingsTable.tsx
  git commit -m "feat(dashboard): Ledger Gold Portfolio workspace + search/sort/group + Real Estate chip"
  ```

---

## Task 4: Alerts workspace redesign (becomes home for staleness detail)

**Files:**
- Modify: `dashboard/src/components/alerts/AlertsScreen.tsx`
- Read: `dashboard/src/components/journey/StalenessBanner.tsx` (the FULL detail
  logic this task migrates here — Task 1 already condensed Journey's copy of this
  to a chip; this task is where the detail actually lives now)

**Interfaces:**
- Consumes: whatever data hook `StalenessBanner.tsx` currently uses to compute
  per-source staleness (read the file, reuse the same hook/derivation here — do
  not reimplement the staleness calculation, import or extract it).

- [ ] **Step 1: Read `AlertsScreen.tsx` and `StalenessBanner.tsx` fully**

  Confirm current Alerts content (likely sparse/empty per the design brief's
  observation — verify against real data via `run-dashboard` skill before
  assuming).

- [ ] **Step 2: Add a "Data freshness" section to Alerts using StalenessBanner's logic**

  Extract the per-source staleness list (source name, last-updated timestamp,
  action hint — e.g. "Request Fresh CAS") from `StalenessBanner.tsx` into a
  form `AlertsScreen.tsx` can render as a real Card list (one row per stale
  source), styled consistently with whatever alert-row pattern already exists
  in `AlertsScreen.tsx` for other alert types. If `StalenessBanner.tsx`'s logic
  is a self-contained pure function, import it directly; if it's tangled with
  that component's own JSX, extract the pure derivation into a small shared
  module (e.g. `journey/staleness.ts`) that both `StalenessBanner.tsx` (Task 1's
  condensed chip) and `AlertsScreen.tsx` (this task) import — this is the one
  place in this plan where a small refactor-extraction is expected, not
  optional duplication.

- [ ] **Step 3: Restyle existing alert content (if any) to Ledger Gold Card system**

- [ ] **Step 4: Verify + screenshot + commit**

  ```bash
  cd dashboard && npm run typecheck && npm run lint && npm run check:contract
  git add dashboard/src/components/alerts/AlertsScreen.tsx \
          dashboard/src/components/journey/StalenessBanner.tsx
  git commit -m "feat(dashboard): Ledger Gold Alerts workspace + promoted data-freshness detail"
  ```

---

## Task 5: Properties workspace redesign

**Files:**
- Modify: `dashboard/src/components/holdings/PropertiesScreen.tsx`

- [ ] **Step 1: Read the file fully.**
- [ ] **Step 2: Apply Ledger Gold Card system** — per-property detail cards
  (current value, cost basis, gain, last-valuation date per design brief §3.5),
  `PageHeader` at top, consistent spacing/shadow/typography with every other
  workspace. No content/IA change on this page itself — only its nav prominence
  changed (Task 0), this task is a pure restyle.
- [ ] **Step 3: Verify + screenshot + commit.**

  ```bash
  cd dashboard && npm run typecheck && npm run lint && npm run check:contract
  git add dashboard/src/components/holdings/PropertiesScreen.tsx
  git commit -m "feat(dashboard): Ledger Gold Properties workspace restyle"
  ```

---

## Task 6: Groww/Sharekhan Data workspace redesign

**Files:**
- Modify: `dashboard/src/components/holdings/GrowwSharekhanDataScreen.tsx`
- Modify: `dashboard/src/components/holdings/ManualEquitiesScreen.tsx`

- [ ] **Step 1: Read both files fully.**
- [ ] **Step 2: Restyle forms/upload UI to Ledger Gold** — inputs (shadcn
  `Input`/`Textarea`, already installed), buttons, upload dropzone if present,
  `PageHeader` at top. This is explicitly a **utility/data-entry** screen (design
  brief §3.6) — keep it information-dense and functional, do not force decorative
  elements (donuts, hero numerals) onto it just for visual consistency; card
  structure and typography/color tokens are what carry the Ledger Gold identity
  here, not layout mimicry of the other pages.
- [ ] **Step 3: Verify + screenshot + commit.**

  ```bash
  cd dashboard && npm run typecheck && npm run lint && npm run check:contract
  git add dashboard/src/components/holdings/GrowwSharekhanDataScreen.tsx \
          dashboard/src/components/holdings/ManualEquitiesScreen.tsx
  git commit -m "feat(dashboard): Ledger Gold Groww/Sharekhan Data workspace restyle"
  ```

---

## Task 7: Full-app QA pass

**Dispatch `dashboard-design-reviewer` for this task, not `dashboard-react-engineer`**
— its job is exactly this: verify implementation matches spec and drive the live
app, without trusting a diff or self-report.

- [ ] **Step 1: Run full verification suite**

  ```bash
  cd dashboard && npm run typecheck && npm run lint && npm run check:contract && npm run check:daypnl
  cd .. && uv run pytest   # confirm zero Python-side regressions (should be none — no Python touched)
  ```

- [ ] **Step 2: Live-browser walkthrough, light mode, every workspace**

  Using the `run-dashboard` skill: navigate to each of the 6 workspaces (4 via
  primary nav, 2 via the new Manage menu), screenshot each, compare against this
  session's mockup screenshots where one exists (Journey, Allocation, Portfolio
  — Options A screenshots) and against the design brief's stated intent for
  Alerts/Properties/Groww-Sharekhan Data (no mockup reference for those three,
  judge against §2's system + the other three pages' established look).

- [ ] **Step 3: Check the state matrix**

  For at least the Journey and Portfolio pages (richest state variety): loading
  skeleton, empty state, masked/unmasked privacy toggle, a couple of different
  viewport widths (resize via `resize_window`). Confirm nothing regressed from
  pre-redesign behavior — this pass changes visuals/layout, not data-fetching or
  state logic, so any broken state here is a real bug, not an expected tradeoff.

- [ ] **Step 4: Write findings**

  Append a "## QA findings" section to the bottom of this plan file listing: what
  matches the mockup well, any deliberate deviations and why, any bugs found (and
  whether they were fixed in this same pass or left as a flagged follow-up), and
  the final `npm run build` bundle-size delta (per this repo's convention of
  reporting that number rather than assuming it's fine, established in
  `spec-round3/spec.md`'s precedent).

- [ ] **Step 5: Final commit**

  ```bash
  cd "E:\agentic-portfolio-dashboard"
  git add docs/superpowers/plans/2026-09-12-ledger-gold-redesign.md
  git commit -m "docs: Ledger Gold redesign QA findings + progress log"
  git log --oneline redesign/ledger-gold ^main
  ```

  Do not merge to `main`. Do not push. Leave the branch as-is for the user's
  morning review.

---

## Open dependencies

- Task 1 Step 1's file-path reconciliation (`components/workspaces/
  JourneyWorkspace.tsx` vs. the `components/journey/` directory survey) must
  happen before any Journey code is written — flagged here so whichever agent
  picks up Task 1 does not skip it.
- Task 2/Task 1 `AccountRoads` `variant` prop — whichever task runs second must
  not reinvent it; check git log / the file itself for whether the prop already
  exists before adding it again.
- No contract field is expected to be missing for any task above (every page
  redesign reuses data already fetched today) — if implementation reveals one is
  genuinely needed, do not edit `contract.ts` unattended (Global Constraints);
  note it here instead and skip that specific sub-feature.

---

## QA findings

Task 7 full-app QA pass, `redesign/ledger-gold` @ `1316daf`, 2026-09-12.
Reviewer: `dashboard-design-reviewer`. Light mode only (dark mode is an
explicit out-of-scope fast-follow per §1 / `tokens.md`). No mockup screenshots
survived the session, so Journey/Allocation/Portfolio were judged against the
design brief's *stated intent* rather than a pixel reference.

### Verification suite

| Command | Result |
|---|---|
| `npm run typecheck` | **PASS (no regression)** — exactly 11 errors, identical by file to the known pre-existing baseline: 2 × `charts/options.ts`, 1 × `segments/SegmentBreakdown.tsx`, 6 × `segments/SegmentsScreen.tsx`, 2 × `ui/chart-legend.tsx`. |
| `npm run lint` (oxlint) | **PASS**, exit 0, pre-existing warnings only |
| `npm run check:contract` | **PASS** — all six exports parse (54 holdings, 11 history dates, 2 alerts, goals = 0) |
| `npm run check:daypnl` | **PASS** |
| `uv run pytest` | **PASS**, exit 0, 2 skipped, zero failures (no Python touched this pass) |
| `npm run build` | **FAILS** — but only because it is `tsc -b && vite build` and `tsc -b` hits the same 11 pre-existing errors. Fails identically on `main`. Not a regression; bundle sizes below were therefore measured with `npx vite build`. |

### Non-negotiables — all pass

- **Determinism boundary intact.** `/api/ask` appears only in `ChatDrawer.tsx`
  and a `types/bridge.ts` docstring. No new surface calls the agent.
- **Contract untouched.** Zero diff in `dashboard/src/types/contract.ts`,
  `scripts/`, or `src/portfolio/`. No component reads a field outside the Zod
  schemas.
- **`index.css` diff is exactly the 3 sanctioned lines** — `--chart-journey`
  in `:root`, the same in `.dark`, `--color-chart-journey` in `@theme inline`.
  `.dark {}` is otherwise byte-identical; `--chart-1`..`--chart-9` untouched,
  as `tokens.md` requires.
- **Navigation still in-memory.** `useWorkspace` / `onWorkspaceChange`; the new
  `ManageMenu.tsx` dispatches through the same hook. No routing assumption added.
- **Privacy masking comprehensive.** Every money figure on Journey (hero,
  today panel, account roads, goals) and Portfolio (stat cards, table rows,
  subtotals) flips to `MASK_TEXT`. Verified live with the eye toggle.
- **Console clean.** Zero errors and zero warnings across the entire
  six-workspace walkthrough, all viewports, and both loading and loaded states.

### IA restructure — verified end-to-end

- 4 primary pills (Journey / Allocation / Portfolio / Alerts) + a **Manage**
  dropdown containing exactly Properties and Groww/Sharekhan Data, with a
  correct active state when a secondary workspace is current.
- **The staleness loop closes.** Journey's condensed chip
  ("3 sources need attention →") navigates to Alerts, which shows the promoted
  per-source *Data freshness* detail (Zerodha fresh, Moomoo fresh, Groww MFs /
  Groww equities / Sharekhan stale, each with an action hint). This was the
  single most important thing the restructure was supposed to buy, and it works.

### What matches the brief's intent well

- **Journey hero** — Fraunces numeral, live-sync chips, condensed staleness
  chip. Reads exactly like §2's "one number, calmly" intent.
- **JourneyChart restyle** — verified *rendered*, not just authored:
  `stroke-width: 2.5`, `stroke-linecap: round`, `var(--border)` dashed `4 4`
  gridlines, gold gradient fill, `shadow-md` Card. §4 satisfied.
- **Allocation** — real ECharts donut rings with beside-legends, promoted
  full-width Account Roads.
- **Alerts** — now genuinely the single home for "things needing attention."
- **Portfolio** — search, sort, group-by-platform, and the Real Estate chip all
  work, with subtotals recomputing correctly. Null `avgPrice` renders `—`.
  Goals empty state renders cleanly.
- **Loading skeletons** are on-palette ivory, no layout shift, no console noise
  (`qa-journey-loading-skeleton.png`, `qa-portfolio-loading-skeleton.png`).
  Portfolio's skeleton matches its final layout well (4 stat cards + table).

### Deliberate deviations noticed — and whether they hold up

1. **JourneyChart uses one constant bronze-gold `trendColor`** instead of the
   pre-redesign per-range gain/loss color swap. Documented in-file with the
   reasoning (direction is still legible via the delta chips, tooltip, and
   YearStrip). **Justified** — this is exactly the restraint §2 asks for.
2. **`AccountRoads` excludes `real_estate`** while the same page's "By platform"
   donut includes it at 33.8%. Defensible (real estate has no meaningful
   day-over-day road) but currently *undocumented and unexplained to the user*
   — see Minor findings.
3. **Categorical `--chart-1`..`--chart-9` left saturated.** Sanctioned by
   `tokens.md`'s "explicitly not touched." Noting only that the cumulative
   effect (saturated blue/green/gold/red/purple donuts and bars against ivory,
   visible in `qa-allocation-donut-tooltip.png`) is the largest remaining
   off-brand surface in the app. **For `dashboard-ui-designer`**, as a
   fast-follow scope call — not an engineering defect.

---

### Findings

Severity is this reviewer's own judgment.
**Critical** = breaks a non-negotiable or a core brief requirement.
**Important** = spec deviation with real user impact. **Minor** = polish.

#### Critical

**C1. Hardcoded dark chart colors propagated into new light-mode code.**
`dashboard/src/components/charts/options.ts` — tooltip block
`backgroundColor: 'rgba(20,20,24,0.92)'` / `borderColor: 'rgba(255,255,255,0.1)'` /
`textStyle.color: '#e8e8ea'` is repeated **8×** (≈ lines 56, 135, 185, 238, 319,
373, 427, 494), plus top-of-file `CHART_TEXT = '#9b9ba3'`,
`AXIS_LINE = 'rgba(255,255,255,0.08)'` and `CATEGORY_COLORS = ['#6f7cff', …]`.
The new donut option added by Task 2 (+133 lines) **copied this pattern rather
than tokenizing it**, so the redesign actively extended a
no-hardcoded-colors violation.
*Confirmed live, not inferred*: hovering the Allocation "By geography" donut
with a real mouse produces a tooltip computing to
`background-color: rgba(20, 20, 24, 0.92)` / `color: rgb(232, 232, 234)` — a
dark chip on an ivory page (`qa-allocation-donut-tooltip.png`). The same file's
`AXIS_LINE` is white-on-white, i.e. the Platform-breakdown bar chart's axis line
is invisible in light mode.
*Required instead*: `var(--card)` / `var(--border)` / `var(--foreground)` per
`tokens.md`; this is a repo non-negotiable independent of what the brief said.
→ **`dashboard-react-engineer`**. Some of it is pre-existing, but Task 2 is what
put it in front of the user on a redesigned light page, so it belongs to this pass.

#### Important

**I1. Journey desktop layout is badly imbalanced at ≥1280px.**
`lg:grid-cols-[1fr_340px]`. Measured column heights: left 463px (999px wide) vs
right rail 1407px — roughly **944px of dead ivory** in the *primary* column. The
page's most important content occupies the top third of a very tall scroll.
Disappears at 768px where it stacks. → engineer.

**I2. Account Roads condensed labels truncate to a single character.**
`dashboard/src/components/journey/AccountRoads.tsx:91–106`. The row is
`flex gap-3` with fixed children: dot 8 + `MiniSpark` 64 (`width = 64`, line 58)
+ value `min-w-[92px]` + delta `min-w-[84px]` + 4 × `gap-3` (48) = **296px** of
the 307px available in the condensed card, leaving ~11px for the label, which
is `min-w-0 flex-1 truncate`. Result: "G", "M", "Z.", "S.".
The `variant` prop gates **row count only** (`CONDENSED_ROW_LIMIT`), not row
layout — so the condensed variant is unreadable as a platform breakdown.
*Required instead*: the brief's intent is a labeled per-platform snapshot; the
label is the one part that cannot be dropped. → engineer.

**I3. `TrendChart.tsx` was never restyled but renders as a first-class card on
the redesigned Allocation page.** Confirmed absent from
`git diff --stat main..HEAD -- dashboard/src`. Visible at the bottom of
`qa-allocation-donut-tooltip.png`: saturated blue/purple/green stacked area with
a lavender wash, next to Ledger Gold cards. Either restyle it or drop it from
the page. → engineer (if it should be restyled) / designer (if the call is to
remove it).

**I4. "Day-over-day change" bar strip renders only one visible bar.** One value
(+₹75.48L) dwarfs the rest, so every other bar computes to ~0px height. The
strip conveys nothing. Needs a symlog/relative scale or a different encoding.
→ engineer.

**I5. `TOP GAINERS` / `TOP LOSERS` headings are ALL-CAPS and use a
non-Ledger-Gold card treatment.** `AllocationScreen.tsx:70–82`
(`uppercase tracking-wider`, plus ad-hoc `border-gain/30 bg-gain/5` instead of
`Card`). Task 0's Interfaces block explicitly says *no ALL-CAPS label* per this
repo's `frontend-design` guidance. → engineer.

**I6. Portfolio holdings table overflows horizontally at 1512px.**
`scrollWidth 1645` vs `clientWidth 1458`; the "Day %" column is clipped off the
right edge with no visible scroll affordance at the default desktop width.
→ engineer.

#### Minor

- **M1.** Allocation label casing is inconsistent within one row of cards:
  Title Case platforms ("Real Estate", "Groww") beside lowercase asset classes
  ("real estate", "mutual fund", "etf"). Visible side-by-side in
  `qa-allocation-donut-tooltip.png`. → engineer.
- **M2.** `AccountRoads` silently excludes `real_estate` (`AccountRoads.tsx:122`)
  while the adjacent donut shows it at 33.8% — the two cards disagree with no
  explanation. Add a one-line note, or include it. → engineer.
- **M3.** Properties shows three identical summary cards, one of which uses
  `.font-headline` (30px Fraunces) while the other two are 28px sans. Reads
  accidental, and is a literal deviation from §2's *"keep that restraint rule,
  do not spread serif to other numbers."* → engineer to unify;
  **cc `dashboard-ui-designer`** if the serif there was intentional.
- **M4.** Nav label "Groww/Sharekhan Data" vs that page's H1 "CAS Import" —
  pick one name. → engineer.
- **M5.** Portfolio's Segment selector is still a native `<select>`; §5 prefers
  a shadcn Select. → engineer.
- **M6.** Journey chart's leftmost x-tick is clipped ("-24" instead of "08-24");
  milestone value labels collide at ≤1024px. Both pre-existing. → engineer.
- **M7.** Nav pill track overflows at 768px, hiding the "Alerts" tab behind a
  horizontal scroll with no affordance. → engineer.
- **M8.** Loading skeletons don't mirror final layout on Journey (renders one
  wide block + 3 cards; the loaded page is a 2-col grid with a right rail), and
  the `PageHeader` is absent during loading on Portfolio, so the H1 pops in.
  Cosmetic. → engineer.

#### Pre-existing, out of scope — noted, not attributed to this pass

- `dashboard/src/components/layout/HealthTicker.tsx:100` has `gap-y-1` but no
  `flex-wrap`, so the footer blows up to 111px tall and overflows at 768px. The
  correct pattern already exists in
  `SegmentReconcileBar.tsx:52,56` (`flex flex-wrap items-center gap-x-4 gap-y-1`).
  Untouched by this branch; worth a separate one-line fix.

### Bundle-size delta

`npx vite build` (bypassing the pre-existing `tsc -b` failure), branch
`redesign/ledger-gold` @ `1316daf` vs `main` @ `a0afe2a` built from a scratch
worktree with the same `node_modules`:

| Asset | main | branch | delta |
|---|---|---|---|
| `index-*.css` | 58.69 kB (10.63 gz) | 60.93 kB (10.92 gz) | **+2.24 kB (+0.29 gz)** |
| `index-*.js` | 689.01 kB (212.47 gz) | 708.84 kB (217.30 gz) | **+19.83 kB (+4.83 gz)** |
| `echarts-*.js` | 604.32 kB (204.36 gz) | 604.32 kB (204.36 gz) | 0 |
| `react-*.js` | 194.38 kB (61.75 gz) | 194.38 kB (61.75 gz) | 0 |
| `data-*.js` | 163.33 kB (44.10 gz) | 163.33 kB (44.10 gz) | 0 |
| **Total** | **1711.54 kB (534.23 gz)** | **1733.59 kB (539.35 gz)** | **+22.05 kB (+5.12 kB gz, +0.96 %)** |

Module count 3633 → 3637 (the 4 new files: `journey/staleness.ts`,
`layout/ManageMenu.tsx`, `layout/PageHeader.tsx`, `ui/dropdown-menu.tsx`).
**No new vendor chunk; ECharts was already bundled.** +5 kB gzip for a
six-page redesign plus a Radix dropdown is a reasonable cost.

### Coverage statement

Verified in a live browser on light mode at 1512 / 1024 / 768 px:
all six workspaces (Journey, Allocation, Portfolio, Alerts via primary nav;
Properties, Groww/Sharekhan Data via Manage), against the real exports in
`dashboard/public/data/` — including the sparse cases (`goals.json` empty →
empty state, null `avgPrice` → `—`, an 11-point history, Sharekhan at 0.4 %
of the portfolio). Loading skeletons captured for Journey and Portfolio via
request delay. Privacy mask toggled on Journey and Portfolio. Donut tooltip
exercised with a real mouse hover (synthetic `MouseEvent` dispatch does not
work — ECharts/zrender does its own hit-testing). **Not verified: dark mode**
(out of scope this pass) and the Refresh / CAS-upload actions (deliberately not
clicked — they trigger live broker or import side effects).
