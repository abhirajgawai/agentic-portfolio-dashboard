# Ledger Gold Redesign — Design Brief

**Status:** Approved by user in conversation on 2026-09-11/12 (see session transcript —
user selected "Ledger Gold" from three mocked directions, granted full authority to
restructure information architecture and rebuild/replace components, explicitly
authorized unattended overnight execution with no further check-ins). This document
is the design-of-record for that approval; there is no separate user sign-off step
since the user is asynchronous for the duration of this work.

**Branch:** `redesign/ledger-gold` (local only — never pushed, never merged without
explicit user review).

## 0. What triggered this

Current UI (see `docs/design/audit/2026-08-27-journey-redesign-audit.md` and the
screenshot taken at session start) is flat, dark-only, borderless — sparse rows with
no card containers, no shadows, no visual hierarchy, cramped layout. User provided a
light fintech-SaaS reference image as *inspiration only* (not to be copied) and asked
for something "even more beautiful" — sleek, modern, elegant. Three directions were
mocked as static HTML (Ledger Gold / Midnight Terminal / Paper & Ink); user chose
**Ledger Gold**: warm ivory background, Fraunces serif hero numerals reserved for the
net-worth figure, bronze-gold accent, soft multi-layer card shadows, pill-style nav.

## 1. Scope

**In scope, this pass:**
- Light theme, built to match the approved Ledger Gold mockup's visual language
  (`docs/design/spec-ledger-gold/tokens.md`, written below) as closely as real data
  and interaction states allow.
- All 6 existing workspaces: Journey, Allocation, Portfolio, Alerts, Properties,
  Groww/Sharekhan Data — every one gets the Ledger Gold visual treatment.
- Real UX/IA reconsideration of what content lives on which page and how the top
  nav presents 6 destinations (§3) — not a pure reskin.
- Journey chart restyled to Ledger Gold (gold gradient fill, refined grid/tooltip) —
  see §4 for why this is a restyle, not the ground-up rebuild the mockup's static SVG
  might suggest.
- Full component license: shadcn/ui components, new custom components, or rebuilding
  existing ones — whichever serves the result. No obligation to preserve any
  existing component's internals.

**Explicitly out of scope, this pass (fast-follow later):**
- Dark theme (`.dark` token set). Existing dark tokens stay as-is for now; do not
  delete or repurpose them, a future pass redesigns dark mode using this same
  system's principles.
- Any change to `dashboard/src/types/contract.ts`, `scripts/export_json.py`, or any
  Python pipeline / bridge code. This is a frontend-only visual and IA pass. If a
  page's ideal redesign seems to need a field the contract doesn't expose, note it
  as an open dependency in the plan rather than touching the contract unattended.
- Any change to routing mechanics (`WorkspaceId` stays a 6-member union, `useWorkspace`
  hook's public shape stays the same) — see §3 for why the nav *presentation* changes
  but the underlying page registry does not merge/delete workspaces.
- Any git push, PR, or merge to `main`.

## 2. Design system — "Ledger Gold" (light mode)

Full token mapping lives in `docs/design/spec-ledger-gold/tokens.md` (written
alongside this brief). Summary:

| Token | Value | Notes |
|---|---|---|
| `--background` | `oklch(0.985 0.008 75)` ≈ `#FBFAF7` | unchanged from current `:root` — already correct, current UI just never gave it cards to sit under |
| `--card` | `#FFFFFF` | unchanged |
| `--primary` / accent | `oklch(0.56 0.135 65)` ≈ `#B8823D` | unchanged token value; the redesign's job is *using* it consistently (chart line, active nav, brand mark) not scattering it |
| `--foreground` | `oklch(0.22 0.018 58)` ≈ `#2E2620` | unchanged |
| `--muted-foreground` | `oklch(0.48 0.02 60)` ≈ `#8A8073` | unchanged |
| `--gain` / `--loss` | unchanged existing tokens | |
| `--shadow-sm/md/lg` | unchanged existing tokens | currently defined but under-used — the redesign's job is applying them to real card containers |
| Hero serif | `Fraunces` via existing `.font-headline` class | already defined, already reserved for net-worth figure — keep that restraint rule, do not spread serif to other numbers |

**Key finding:** the existing `index.css` token *values* already match the approved
mockup almost exactly (the mockup's palette was deliberately built by evolving these
tokens, not inventing new ones — see the session's earlier design-plan step). The
redesign is therefore primarily a **component and layout** problem (real `Card`
wrappers, consistent padding/shadow, typographic hierarchy, grid structure) rather
than a **token** problem. This matters for the plan: tasks should mostly touch `.tsx`
component files, not `index.css` — flag any token gap found during implementation
rather than assuming new tokens are needed.

## 3. Information architecture — nav restructure

The mockup review surfaced a real UX question, not just a visual one: a personal
net-worth dashboard's primary nav should answer "views of my money" (Journey,
Allocation, Portfolio, Alerts). Two of the six current top-level tabs are not that:

- **Properties** is a thin, low-cardinality data view (one to a handful of manually
  entered real-estate rows) — today it's a peer-weighted tab next to "Portfolio"
  (54 holdings) despite being a fraction of the content.
- **Groww/Sharekhan Data** is a maintenance/data-entry utility screen (CAS upload,
  CAS auto-import trigger, manual equity totals form) — it is not a "view my wealth"
  screen at all, it is closer to a settings page.

**Decision:** keep all 6 workspaces fully reachable (zero deletion of functionality,
zero change to `WorkspaceId` or routing internals — this is a presentation-layer
decision only, chosen specifically because it carries none of the data-layer risk a
real page-merge would, which matters for unattended execution with no one to catch a
broken CAS flow overnight):

- **Primary nav (equal-weight tabs):** Journey, Allocation, Portfolio, Alerts.
- **Secondary access:** Properties and Groww/Sharekhan Data move to a compact
  "Manage" affordance in the header (a small icon-button + dropdown, next to the
  existing search/notification icon-buttons already in the mockup) — one click away,
  same components, same data hooks, just not competing visually with the four primary
  views. Properties' real-estate rows also get a lightweight presence as a filter
  chip on the Portfolio page (§3.3) so a user sees total wealth including property
  without a tab switch, while the full Properties workspace (with cost basis / last
  valuation date / edit form) stays reachable via Manage for anyone doing data entry.

Per-page content rationale (what a person actually opens each page to do):

### 3.1 Journey — "how am I doing, right now and over time"
Daily pulse-check. Keep: net-worth hero, trend chart, today's change, a *condensed*
account snapshot (small multi-platform strip, not the full detail table). Move out:
the current per-source staleness banner's full text detail — collapse to a compact
"N sources need attention" chip that deep-links to Alerts (§3.4), since staleness is
fundamentally an attention/alert concept, not a trend concept, and today it visually
dominates the page above the chart. Goals/milestones stay on Journey (a target net
worth is a trend concept, belongs next to the chart it tracks progress against).

### 3.2 Allocation — "where is my money, and is that healthy"
Keep asset-class / venue / currency donuts. **Gains** the full "Account roads"
breakdown (per-platform value + trend + delta) promoted from a Journey sidebar
widget to a first-class section here — it is fundamentally an allocation question
("how much in each place, how did each move"), and giving it real room here (instead
of a cramped 300px sidebar column) lets it show more than 4 rows without scrolling.

### 3.3 Portfolio — "what do I actually own, line by line"
Holdings table stays the core. Adds real table affordances a user actually wants:
search-by-instrument, sort by value/day-change/P&L, group-by-platform toggle. Adds a
"Real estate" filter chip alongside the existing platform chips (Groww/Moomoo/
Zerodha/Sharekhan) that surfaces Properties' rows inline as a read-only summary row
per property — not a duplicate data model, just this page's table rendering
Properties' existing data alongside brokerage holdings when that chip is active.

### 3.4 Alerts — "what needs my attention"
Currently likely sparse/empty (no alerts configured in the sample data seen this
session). Becomes the single home for *all* "needs attention" surfaces: the
data-staleness list Journey used to show in full, plus whatever price/threshold
alerts the existing Alerts workspace already renders. This is the page that makes
Journey's new compact staleness chip (§3.1) meaningful — it has somewhere real to
link to.

### 3.5 Properties (secondary nav)
Focused real-estate detail: current value, cost basis, gain, last-valuation date, per
property. Gets the same Ledger Gold card treatment as every other page; no IA change
to its own content, only to its nav prominence (§3, moved to Manage).

### 3.6 Groww/Sharekhan Data (secondary nav)
No content change — CAS upload / auto-import trigger / manual totals form stay
exactly as they function today. Gets Ledger Gold form styling (inputs, buttons,
upload dropzone) so it doesn't look like a different, older app bolted onto the
redesigned four primary pages. Nav prominence only change (§3, moved to Manage).

## 4. Journey chart — restyle, not rebuild

The user's stated complaint is "I don't like the graph on the landing page, do it
better." Before assuming a ground-up technical rebuild (which the static SVG in the
mockup might imply), the actual current implementation was checked:
`dashboard/src/components/journey/JourneyChart.tsx` (598 lines) plus `MilestonePin.tsx`,
`DeltaChipRail.tsx`, `EmptyGlyph.tsx` were rebuilt three months ago in commit `a0afe2a`
per `docs/design/spec-round3/spec.md` — already on `@visx` primitives (not Recharts),
already has: path-morph tweening on range change, a glow filter, dense/sparse mode
branching, a manual tooltip, `prefers-reduced-motion` handling, and WCAG-considered
ARIA labeling.

**Decision:** restyle this chart to Ledger Gold rather than replace its technical
foundation — the existing implementation is sound engineering that a full
ground-up rewrite would re-risk (motion correctness, a11y, sparse/dense branching)
for no visual gain, since all of the following are pure restyle changes on top of the
existing `@visx` primitives:
- Area gradient: bronze-gold (`var(--chart-1)`, but the redesign should confirm this
  resolves to the actual gold token, not the blue-purple `chart-1` currently defined
  for the *categorical* chart palette — likely needs a dedicated `--chart-journey`
  token or direct `var(--primary)` reference; flag and resolve during implementation,
  this is exactly the kind of token gap §2 says to expect and report rather than
  assume) — three-stop gradient, peak opacity high enough to read as a wash in light
  mode.
- Line stroke: bronze-gold, thicker (2.5px), rounder caps — matches mockup.
- Gridlines: warm neutral (`var(--border)`), dashed, sparser (fewer, more confident
  lines vs. current density).
- Card wrapper: the chart sits inside a real elevated `Card` with the padding/shadow
  system every other component in this redesign uses (§2) — today it likely renders
  in a borderless section, per the pre-redesign screenshot.
- Milestone dots / "today" pulse: recolor to gold accent family, keep existing glow
  filter mechanism.
- Tooltip: restyle to match new card/shadow/typography system, keep existing
  positioning logic.

If, during implementation, a specific interaction genuinely cannot be achieved
through restyling (not expected, but flagged per this repo's convention of surfacing
judgment calls rather than silently absorbing them), the fallback is to note it in
the plan's open-dependencies section rather than silently doing a larger rebuild
unattended.

## 5. Component strategy

- Prefer shadcn/ui primitives (`Card`, `Badge`, `Button`, `Tabs`, `Input`,
  `DropdownMenu`, `Tooltip`, etc. — check `dashboard/components.json` /
  `dashboard/src/components/ui/` for what's already installed via the shadcn MCP
  before adding new registry components) over hand-rolled equivalents.
- New custom components only for genuinely bespoke pieces (the net-worth hero
  treatment, the donut charts, the holdings table's specific column layout) — same
  principle the existing codebase already follows.
- Donuts: check `dashboard/src/components/segments/` and `dashboard/src/lib/charts.ts`
  first — CLAUDE.md notes ECharts is already in use elsewhere in the app; reuse
  that existing charting investment for Allocation's donuts rather than introducing
  a third charting approach (visx is already used for Journey's line chart per §4;
  a third library for donuts would be an unforced increase in bundle size and
  maintenance surface with no user-visible benefit over restyling what's there).

## 6. Risk mitigations for unattended execution

- Local branch only (`redesign/ledger-gold`), commits at natural checkpoints (per
  page / component), never pushed.
- No contract, pipeline, bridge, or routing-mechanics changes (§1) — every change in
  this pass is contained to `dashboard/src/` presentational/component code, which
  bounds the blast radius of an unsupervised mistake to "the UI looks wrong," never
  "the data pipeline broke" or "money math changed" (CLAUDE.md's determinism
  boundary is untouched by construction).
- `npm run typecheck`, `npm run lint`, `npm run check:contract` run after each page's
  implementation task, not just at the end — catches regressions early enough to fix
  within the same unattended run instead of compounding across 6 pages.
- Visual QA via the `run-dashboard` skill + `claude-in-chrome` screenshot comparison
  against the approved mockup happens per page, self-reviewed (no user available) —
  documented in the plan's progress log, not silently assumed correct.
- If a page's real data shape reveals the mockup was wrong about something (e.g. a
  field doesn't exist, an edge case the static mockup didn't model), the implementer
  makes the most reasonable call consistent with §2's system and notes the deviation
  in the progress log — never blocks waiting for input that won't come tonight.

## 7. Self-review (per brainstorming skill)

1. **Placeholder scan:** no TBD/TODO in this document — the two intentionally-deferred
   items (dark mode, contract changes) are explicit exclusions with reasons, not
   placeholders.
2. **Internal consistency:** §3's "keep all 6 workspaces, change nav presentation
   only" is consistent with §1's "no routing-mechanics changes" and §6's risk
   framing — checked, no contradiction.
3. **Scope check:** this is one coherent visual+IA system applied to one app's
   frontend — appropriately scoped for a single implementation plan (broken into
   per-page tasks within that one plan, not split into separate plans, since every
   page shares the same token/component foundation being built first).
4. **Ambiguity check:** §4's chart gradient token gap is the one known open question;
   resolved by explicit instruction to introduce a `--chart-journey` token (or reuse
   `--primary`) and document the choice, rather than left ambiguous for the
   implementer to guess at 3am.

No user review step follows (async execution, per session authorization). Proceeding
directly to `writing-plans`.
