# Journey Redesign (Round 3) — Implementation Spec: "Ascent"

**Handoff document for `dashboard-react-engineer`.** Read first:
`docs/design/selected/2026-08-27-journey-redesign-selected-direction.md`
(decision + scope + floor fixes folded in from the two non-selected
directions) and `docs/design/audit/2026-08-27-journey-redesign-audit.md`
(root causes this spec fixes, numbered §3 in the audit — referenced by number
below). This spec is self-contained: no other doc needs to be open to build
from it.

**Scope: Journey workspace only.** Files outside
`dashboard/src/components/journey/` are touched only where explicitly listed
in §1. Nothing in Portfolio / Allocation / Alerts / Properties / Groww-Sharekhan
Data changes.

---

## 0. Hard constraints (non-negotiable, carried forward from round 2)

1. `dashboard/src/types/contract.ts` — **IMMUTABLE**. This spec uses only
   `History.dates`, `History.portfolioValueBase`, `History.byGeography`,
   `History.byPlatform` — all already read by the current `JourneyChart.tsx`.
   No new field is required (§10 confirms no open contract dependency).
2. Determinism boundary unaffected — this round touches zero agent/chat code.
3. Stack: Vite 8 + React 19.2 + TS strict, Tailwind v4 (CSS-first), shadcn/ui
   v4 New York, TanStack Query, Zod v4. Recharts (`^3.8.0`) and ECharts
   (`^6.0.0`) **stay installed** and **stay in use everywhere else in the
   app** — only `JourneyChart.tsx`'s plot area moves off Recharts, onto the
   new `@visx` primitives below. Do not touch `dashboard/src/lib/charts.ts`
   (ECharts) or any other screen's Recharts usage.
4. Both themes first-class. Every color referenced by new code is one of the
   tokens in `docs/design/spec-round3/tokens.json`'s `reused_tokens_by_use`
   map — **zero new CSS custom properties**, confirmed in that file.
5. **Bundle budget: this round's new dependencies total ~20-23KB gzip**
   (§7 has the exact package list). This is explicitly *not* covered by
   round 2's original +50KB total-app budget on its own — flag the actual
   `npm run build` delta to the user after implementation; do not silently
   accept an overage without surfacing the number (open dependency, §10).
6. WCAG AA both themes. `prefers-reduced-motion: reduce` disables ALL new
   motion (path morph, spring counters, milestone pop, entrance stagger) —
   see `accessibility/a11y-spec.md` and `motion/motion-spec.md` for the exact
   fallback per interaction.
7. Privacy mask (`usePrivacy()` / `MASK_TEXT` from `dashboard/src/lib/format.ts`
   and `dashboard/src/lib/privacy.tsx`) — every money value drawn by the new
   chart (axis ticks, endpoint labels, tooltip, delta chips, milestone halo
   labels) must honor it exactly as the current `JourneyChart.tsx` does
   (`formatYTick`, `LabelList formatter`, tooltip `formatter`). Percentages
   and point counts stay visible when masked (existing convention).
8. No fabricated data. Sparse-data handling is a real alternate rendering
   mode driven by the real point count — never a placeholder/lorem chart.

---

## 1. Files touched

```
dashboard/package.json                                  — MAJOR: 6 new deps (§7)
dashboard/src/components/journey/JourneyChart.tsx        — MAJOR: full plot rebuild on @visx
dashboard/src/components/journey/MilestonePin.tsx        — MAJOR: teardrop pin → halo dot,
                                                             recharts scale hooks → visx scales
dashboard/src/components/journey/DeltaChipRail.tsx        — NEW: replaces DayChangeStrip for
                                                             sparse mode (floor fix, §4.2)
dashboard/src/components/journey/EmptyGlyph.tsx           — NEW: shared inline-SVG empty-state
                                                             glyph (floor fix, §4.6)
dashboard/src/components/journey/animation.ts             — MAJOR: useAnimatedNumber internals
                                                             swapped to a motion spring; public
                                                             signature UNCHANGED
dashboard/src/components/journey/motion.ts                — MINOR: add a shared spring-config
                                                             export used by animation.ts +
                                                             GoalMilestones.tsx + JourneyChart.tsx
dashboard/src/components/journey/JourneyWorkspace.tsx     — MAJOR: Entrance (manual setTimeout+
                                                             CSS class) → motion staggerChildren
dashboard/src/components/journey/GoalMilestones.tsx       — MINOR: crossed-goal card gets a
                                                             spring scale pop (1→1.15→1) instead
                                                             of instant Badge appearance
dashboard/src/components/journey/journal.ts                — UNCHANGED (pure derivation, reused
                                                             as-is — deriveMilestones, formatShortDate)
dashboard/src/components/journey/useInView.ts               — UNCHANGED (reused for lazy-mount)
dashboard/src/lib/privacy.tsx, src/lib/format.ts             — UNCHANGED (reused as-is)
dashboard/src/types/contract.ts, src/lib/data.ts             — UNCHANGED (contract immutable)
```

`dashboard/src/components/journey/DayChangeStrip` (currently an internal
function inside `JourneyChart.tsx`, not its own file) is **deleted**, its job
split between dense-mode chart chrome (kept, restyled) and `DeltaChipRail.tsx`
(new, sparse mode only — see §4.2).

---

## 2. New dependencies — exact versions

Install in `dashboard/` (`npm install` from that directory):

| Package | Version (resolved 2026-08-27) | Type |
|---|---|---|
| `@visx/shape` | `^4.0.0` | dependency |
| `@visx/scale` | `^4.0.0` | dependency |
| `@visx/gradient` | `^4.0.0` | dependency |
| `d3-interpolate-path` | `^2.3.0` | dependency |
| `@types/d3-interpolate-path` | `^2.0.3` | devDependency |
| `motion` | `^13.1.1` | dependency |

All confirmed React 19–compatible at these versions (`@visx/shape`'s and
`@visx/gradient`'s own `peerDependencies` list `react: "^18.0.0 || ^19.0.0"`;
`motion`'s peer deps list the same for `react`/`react-dom`). `@visx/scale`
depends internally on `@visx/vendor` (bundled d3 scale internals) — no
separate d3 install needed. Do not add `d3` or `@types/d3` directly; visx
re-exports what's needed.

**Import discipline (bundle-size critical, §0.5):**
- `motion` — import ONLY from the mini/core animation entry point
  (`import { animate, useMotionValue, useSpring } from "motion"` — NOT
  `"motion/react"`, which pulls in the full component/gesture/layout API at
  ~18-20KB gzip instead of the ~5-6KB core subset this spec needs). Nothing
  in this spec uses `<motion.div>` JSX, drag gestures, or layout animation —
  if any component below turns out to need `AnimatePresence` or `<motion.div>`
  for a state you hit that isn't covered here, treat that as a scope
  question to flag back, not a silent upgrade to the heavier import.
- `@visx/shape`, `@visx/scale`, `@visx/gradient` — import named exports only
  (`import { LinePath, AreaClosed } from "@visx/shape"`, etc.) — these
  packages are already per-concern split, so there is no "full bundle"
  variant to avoid.

---

## 3. `JourneyChart.tsx` — full plot rebuild

### 3.1 What stays exactly as-is (reused, not rebuilt)

- `Card` / `CardContent` wrapper, header (`<h3>Journey</h3>` + subtitle),
  range-pill row (`RANGES`, the pill `<button>` markup, `aria-pressed`) —
  **unchanged**, including the `Custom` pill logic tied to `brushRange` state.
  Since the `Brush` control is removed (§4.1), also remove `brushRange` state,
  the `Custom` pill, and `handleBrushChange`/`clearCustomRange` — nothing
  else in this file or `JourneyWorkspace.tsx` reads `brushRange`, confirmed
  by grep; this is a clean removal.
- `useGoalsData()`, `sliceHistory()`, `chartMilestones()` — pure data/logic,
  reused verbatim.
- `usePrivacy()`, `useInView()`, `usePrefersReducedMotion()` — reused verbatim.
- The `role="img"` + `aria-label` pattern on the chart container (accessible
  name built from `formatInrCompact`/masked state) — reused verbatim, per
  a11y-spec §5 (chart is decoration for screen readers; goals/milestones are
  ALSO DOM list items elsewhere, unaffected by this round).
- `chartConfig` (portfolio/goal/milestone labels+colors) — kept as a plain
  object for tooltip labeling; `ChartContainer`/`ResponsiveContainer` (Recharts
  wrapper components) are **removed** since the plot is no longer a Recharts
  tree — replace with a plain sized `<div>` + `ResizeObserver`-driven width
  (see §3.3).

### 3.2 What's removed

- `<Brush>` entirely — audit root cause #1, floor fix (selected-direction §4.1).
- `DayChangeStrip` function and its `BarChart`/`Bar`/`Cell`/`XAxis` (bar-chart
  variant) — replaced by `DeltaChipRail.tsx` in sparse mode only (§4.2); dense
  mode drops the day-change mini-chart entirely (the restyled hero chart's own
  gridlines/axis carry that information at ≥8 points — a second chart under
  it duplicates work at that density).
- `ComposedChart`/`Area`/`Line`/`XAxis`/`YAxis`/`CartesianGrid`/`Tooltip`/
  `ReferenceLine`/`ResponsiveContainer`/`LabelList` Recharts imports — all
  removed from this file. `<ChartContainer>` (the shadcn chart wrapper) is
  also removed — it's a Recharts-context provider and has nothing to provide
  once the plot isn't Recharts.
- The `line-draw`/`area-fade` CSS animation names referenced in the current
  file's inline `style.animation` (lines ~420, ~453) — **note for the
  engineer:** these keyframe names are referenced but never defined anywhere
  in `index.css` or any other file in the repo (confirmed via repo-wide
  search) — they are currently silent no-ops; the browser drops an unknown
  animation name without erroring, so today's chart has NO entrance draw
  animation despite the code appearing to add one. This is incidentally
  itself part of why the audit's "half-drawn chart" screenshot (audit §1.1)
  looks the way it does on a slow first paint — it's not a mid-animation
  frame, it's layout/paint timing with zero actual CSS animation running.
  This round's path-morph mechanism (§3.5) replaces the intent entirely, so
  no dead keyframe reference should be carried into the new file.

### 3.3 New primitives: `@visx/scale` + manual sizing

Replace `ResponsiveContainer` with a `ResizeObserver` on the chart's wrapping
`<div ref={containerRef}>` (same pattern as `useInView` — a small local hook,
`useElementWidth(ref)`, returned width in px; height stays a fixed constant
per mode, see §4). Build scales with the observed width:

```ts
import { scaleLinear, scaleUtc } from "@visx/scale"

const xScale = scaleUtc({
  domain: [new Date(sliced.dates[0]), new Date(sliced.dates.at(-1))],
  range: [marginLeft, width - marginRight],
})
const yScale = scaleLinear({
  domain: [0, yMax ?? 1],
  range: [height - marginBottom, marginTop],
})
```

`sliceHistory`'s dates are `YYYY-MM-DD` strings — parse with
`new Date(\`${d}T00:00:00Z\`)` (matches the existing `dayDiff` helper in
`journal.ts`, UTC-safe, no timezone drift). Margins: reuse the current
Recharts margin values (`{ top: 10, right: 10, bottom: 0, left: 0 }`) for
dense mode; sparse mode uses `{ top: 24, right: 16, bottom: 8, left: 16 }`
(room for inline endpoint labels, no Y-axis to reserve space for).

### 3.4 New primitives: `@visx/shape` + `@visx/gradient`

```tsx
import { LinePath, AreaClosed } from "@visx/shape"
import { LinearGradient } from "@visx/gradient"
import { curveLinear } from "@visx/curve"
```

- `<LinearGradient id="journey-area-gradient" from="var(--chart-1)" to="var(--chart-1)" fromOpacity={0.32} toOpacity={0} />`
  — three-stop equivalent achieved via `stops` prop:
  `stops={[{ offset: "0%", color: "var(--chart-1)", opacity: 0.32 }, { offset: "55%", color: "var(--chart-1)", opacity: 0.12 }, { offset: "100%", color: "var(--chart-1)", opacity: 0 }]}`
  — this is the audit §1.1 fix ("gradient area fill is essentially invisible
  in dark theme") — peak opacity raised from the current 0.18 to 0.32 and a
  third stop added so the fill reads as a real wash, not a sliver, in both
  themes. Verify visually against `.dark` in the build.
- `<AreaClosed data={chartData} x={(d) => xScale(new Date(d.date))} y={(d) => yScale(d.value)} yScale={yScale} curve={curveLinear} fill="url(#journey-area-gradient)" />`
  — `curveLinear` is **required**, not optional — it preserves the existing
  file's documented honesty rule (carried-forward snapshot values must never
  be smoothed into implying interpolated data that doesn't exist; the current
  file's comment on `type="linear"` makes this explicit and it carries
  forward unchanged).
- `<LinePath data={chartData} x={...} y={...} curve={curveLinear} stroke="var(--chart-1)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />`

### 3.5 Path morphing on range-pill change

```ts
import { interpolatePath } from "d3-interpolate-path"
```

The `<LinePath>` and `<AreaClosed>` components accept a `children` render-prop
that exposes the raw computed path string (`@visx/shape`'s render-prop API:
`<LinePath ...>{(path) => <path d={path(chartData) ?? ""} .../>}</LinePath>`).
Use this to intercept the `d` string:

1. On range change (pill click), capture the **previous** rendered `d` string
   (kept in a `useRef<string>`) and the **new** `d` string computed from the
   freshly sliced data.
2. Build an interpolator: `const interpolator = interpolatePath(prevD, nextD)`.
3. Drive `t` from 0→1 over `PATH_MORPH_DURATION_MS = 400` using `motion`'s
   `animate()` (imperative, not a React state loop — avoids a re-render per
   frame): `animate(0, 1, { duration: 0.4, ease: [0.16, 1, 0.3, 1], onUpdate: (t) => pathRef.current?.setAttribute("d", interpolator(t)) })`.
   The `[0.16, 1, 0.3, 1]` cubic-bezier matches the existing `--ease-out`
   token's curve exactly (`cubic-bezier(0.16, 1, 0.3, 1)` from `index.css`) —
   don't invent a new easing curve, reuse the token's numeric values even
   though this is a JS call, not CSS (documented as a "reused constant", not
   a new token, in `tokens.json`).
4. Apply the same interpolated-path technique to the `<AreaClosed>` fill
   simultaneously (build its own before/after `d`, tween in the same
   `animate()` call via a second `onUpdate` target) so line and fill morph
   together, not just the line.
5. `prefers-reduced-motion: reduce` → skip the tween entirely, set `d`
   directly to `nextD` with no animation (motion-spec §1 below has the exact
   rule). Gate via `usePrefersReducedMotion()`, already imported.
6. On unrelated re-renders (e.g. a data refetch that doesn't change `range`),
   do NOT re-trigger the morph — key the effect on `range` only, not on
   `chartData` identity broadly; a `useEffect([range])` with the `d`-string
   computation happening inside is the correct dependency shape.

This is the single interaction described in the direction doc and the
selection doc as the reason for choosing Ascent — implement it exactly as
above, not approximated with a CSS cross-fade fallback, since a cross-fade
defeats the entire justification for the new dependencies.

### 3.6 Custom SVG glow filter (one shared `<defs>` block)

```tsx
<defs>
  <filter id="journey-glow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="3" result="blur1" />
    <feGaussianBlur stdDeviation="7" in="SourceGraphic" result="blur2" />
    <feMerge>
      <feMergeNode in="blur2" />
      <feMergeNode in="blur1" />
      <feMergeNode in="SourceGraphic" />
    </feMerge>
  </filter>
</defs>
```

Applied via `filter="url(#journey-glow)"` on: the `<LinePath>` stroke, the
"today" pulse ring circle (§3.7), and every milestone halo dot (§5). One
`<defs>` block per chart instance (scoped `id`, no cross-chart collision risk
since only one `JourneyChart` renders at a time). Color comes from each
element's own `stroke`/`fill` (`var(--chart-1)` for the line/pulse,
`var(--chart-3)` for milestones) — the filter itself is colorless (blurs
whatever's fed into it), so no color token is needed on the filter def itself.

### 3.7 "Today" pulse ring

Last point of the line gets a small `<circle>` with a `<circle>` sibling
`::after`-equivalent (SVG doesn't have `::after`, so render a second, larger
circle with an animated `r`/`opacity`) driven by a CSS `@keyframes` (this one
IS pure CSS, no `motion` needed — it's a simple infinite loop, not a
state-driven spring):

```css
/* index.css addition — see rationale.md §for why this is CSS not motion */
@keyframes journey-pulse-ring {
  0% { r: 4; opacity: 0.4; }
  100% { r: 14; opacity: 0; }
}
```

Applied to the outer ring circle only; the inner solid dot stays static.
`prefers-reduced-motion: reduce` → the outer ring circle is not rendered at
all (not just paused) — a static filled dot is the reduced-motion state,
matching the existing global reduced-motion rule in `index.css` (`animation-duration: 0.01ms !important` would otherwise leave a flickering 1-frame ring, which is worse than removing it).

### 3.8 Tooltip

Reuse `ChartTooltipContent` (`dashboard/src/components/ui/chart-tooltip.tsx`)
as a plain presentational component — it already accepts `active`/`payload`/
`label`/`formatter` as plain props with no Recharts-context dependency (only
`ChartTooltip`, not `ChartTooltipContent`, touches Recharts internals — confirm
this in the file before wiring, but as read it's prop-driven). Drive it with
manual pointer-move handling on an invisible full-height/width `<rect>`
overlay: on `onPointerMove`, find the nearest data point by x-position (binary
search or linear scan over `chartData`, this dataset is never large enough to
need optimization), set local `{ active, payload, label }` state, position the
tooltip via absolute CSS positioning at the computed `xScale`/`yScale`
coordinates. This replaces Recharts' built-in `<Tooltip>` cursor-tracking with
an equivalent manual implementation — same visual output (`contentStyle`,
`formatter` for masked/unmasked money), no Recharts dependency required for it.

### 3.9 Dense vs. sparse chart mode (floor fix, audit root cause #2)

```ts
const SPARSE_THRESHOLD = 8

const mode: "sparse" | "dense" = sliced.values.length < SPARSE_THRESHOLD
  ? "sparse"
  : "dense"
```

| | Dense mode (≥8 points) | Sparse mode (<8 points) |
|---|---|---|
| Height | 320px (`h-80`, unchanged) | 220px |
| Y gridlines | Yes — `<line>` elements drawn from `yScale.ticks(5)`, `stroke="var(--border)"`, `strokeDasharray="4 4"` (replaces `CartesianGrid`) | None |
| Y-axis ticks/labels | Yes — text elements at each gridline, `fill="var(--muted-foreground)"`, masked via `formatYTick` | None |
| X-axis labels | Yes — every ~10th point, `formatXLabel` (unchanged `date.slice(5)`) | Inline date labels directly under each point instead |
| Point labels | Only if `sliced.values.length <= 12` (existing threshold, unchanged) | Always — value + date inline above/below each point, `!masked` gated exactly like the current `LabelList` masked check |
| Point dots | Only if `sliced.values.length <= 12` | Always — larger radius (5px vs dense mode's 3px), glow filter applied |
| Below-chart element | None (dropped, see §3.2) | `<DeltaChipRail>` (§4.2) |
| Margin | `{ top: 10, right: 10, bottom: 0, left: 0 }` | `{ top: 24, right: 16, bottom: 8, left: 16 }` |
| Path-morph duration | 400ms | 300ms (snappier for fewer points — matches Pulse §2.6's "dense mode keeps 800ms [draw], sparse drops to 500ms" ratio, applied to morph instead of draw since draw itself is gone) |

Mode switches are data-driven (e.g. picking "1M" on an account whose 1-month
window happens to contain <8 points while "All" has ≥8) — cross-fade the
chart body 150ms on a mode change specifically (separate from the path-morph,
which only runs on same-mode range changes) using a plain CSS opacity
transition, `motion-reduce:transition-none`.

---

## 4. New component: `DeltaChipRail.tsx`

Replaces `DayChangeStrip`'s bar chart for sparse mode only (audit root cause
#3 — "mostly empty at low point counts"). Reuses `AccountRoads.tsx`'s proven
"number leads, icon + colored delta" row pattern (per the audit's own
recommendation, §1.5: *"AccountRoads... is actually the best-aged component
on the page... a useful pattern to extend rather than replace"*).

```tsx
// DeltaChipRail.tsx
export function DeltaChipRail({
  dates,
  values,
  masked,
}: {
  dates: readonly string[]
  values: readonly number[]
  masked: boolean
}) {
  // one chip per adjacent-day transition, same `changes` derivation as the
  // old DayChangeStrip (i from 1..values.length, delta = values[i]-values[i-1])
}
```

- Layout: horizontal flex row, `overflow-x-auto`, one chip per transition:
  `<span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs">` with a `TrendingUp`/`TrendingDown`/`Minus` icon
  (`lucide-react`, already a dependency — same icons `AccountRoads.tsx` uses),
  the short date (`formatShortDate` from `journal.ts`, reused), and the signed
  delta (`formatInrCompact`, masked via `MASK_TEXT` exactly like `AccountRoads`'
  `RoadRowItem`).
- Color: `text-gain`/`text-loss`/`text-muted-foreground` classes (existing
  Tailwind utilities mapped to the `--gain`/`--loss` tokens), matching
  `AccountRoads.tsx` exactly.
- Renders only when `sliced.values.length >= 2` (need at least one delta) —
  same guard the old `DayChangeStrip` used, ported over.
- No horizontal scroll-snap needed at expected chip counts (<20 in sparse
  mode by definition, since sparse mode is <8 points = <7 chips) — plain
  `overflow-x-auto` is sufficient, unlike Chronicle's `MomentStrip` which
  anticipated up to 10-15 cards.

---

## 5. `MilestonePin.tsx` → halo dot rewrite

Floor fix (audit root cause #4). The file is rewritten, not extended — its
Recharts-hook dependency (`useXAxisScale`/`useYAxisScale`) no longer applies
once the chart isn't a Recharts tree; positioning now comes directly from the
`xScale`/`yScale` built in `JourneyChart.tsx` (§3.3), passed as props.

```tsx
// MilestonePin.tsx — renamed concept, same file (avoid a rename that breaks
// the existing import in JourneyChart.tsx; keep the filename, rewrite the
// contents — the export names MilestonePins/useMilestoneHover stay the same
// so JourneyChart.tsx's existing import line needs no path change, only the
// internal implementation and the removed useXAxisScale/useYAxisScale calls)

export function MilestonePins({
  milestones,
  xScale,
  yScale,
  activeDate,
  justCrossedDate, // NEW — see §6 for how this is computed/passed
}: {
  milestones: Milestone[]
  xScale: (date: Date) => number
  yScale: (value: number) => number
  activeDate?: string
  justCrossedDate?: string | null
}) {
  // for each milestone: <g transform={`translate(${xScale(new Date(m.date))}, ${yScale(m.value)})`}>
  //   <circle r={5} fill="var(--chart-3)" filter="url(#journey-glow)" />
  //   {isSignificant(m) && <text>...inline label above the dot, e.g. "Crossed ₹1.00Cr"...</text>}
  // </g>
}
```

- Dot: filled circle, `fill="var(--chart-3)"`, `filter="url(#journey-glow)"`
  (reuses the one shared glow filter from §3.6 — no second filter def).
- Inline label: only for the 1-2 most significant milestones per the
  existing Pulse-sourced rule (§2.5 of Direction 1, adopted here) — "most
  significant" = crossings (`description.startsWith("Crossed")`) and the
  single latest all-time-high, matching `chartMilestones()`'s existing
  crossing-outranks-appearance dedup logic already in this file — no new
  significance logic needed, reuse the existing dedup output directly for
  which milestones get inline labels vs. hover-only.
- Hover/tooltip: keep `useMilestoneHover` exactly as-is (pure function, no
  Recharts dependency, already framework-agnostic) — wire its output into the
  manual tooltip from §3.8 instead of a Recharts-context tooltip.
- **Spring pop on fresh crossing:** when `justCrossedDate === milestone.date`,
  wrap the `<circle>` in a `motion`-driven scale animation: mount at `scale:
  1`, on the pop trigger animate `1 → 1.15 → 1` using the shared
  `SPRING_CONFIG_MILESTONE_POP` from `motion.ts` (§6). Fires once per
  milestone (see §6 for the "once" guarantee), never loops.

---

## 6. Crossing-pop wiring — `motion.ts`, `GoalMilestones.tsx`, `JourneyChart.tsx`

Direction 2 §2.2 item 2 says this "reuses the existing `useGoalCrossing` ack
logic — no new detection code." That's true for the **goal card's** pop (it's
literally inside the component that owns `useGoalCrossing`). The **chart
halo dot's** pop needs a bridge, since `useGoalCrossing` lives in
`GoalMilestones.tsx` and the chart is a sibling, not a parent/child — this is
the one place this spec makes an explicit engineering-judgment call rather
than leaving it ambiguous:

- **Goal card pop (`GoalMilestones.tsx`):** inside `useGoalCrossing`'s
  existing loop (the one that currently calls `toast(...)` once per newly
  crossed goal), also set a small local state, e.g.
  `setJustCrossedGoalId(goal.id)` for one render, cleared via a `setTimeout`
  matching the spring settle duration (~600ms). The rendered `<li>` for that
  goal wraps its `Badge`/icon cluster in a `motion`-driven scale pop keyed on
  `justCrossedGoalId === goal.id`, using `SPRING_CONFIG_MILESTONE_POP`.
- **Chart halo dot pop (`JourneyChart.tsx`):** does **not** need
  `useGoalCrossing` at all — a milestone dot's "freshness" is derivable
  directly from `history` without any goal-crossing state: compute
  `justCrossedDate = milestones.find(m => m.date === history.dates.at(-1))?.date ?? null`
  (i.e. "is there a milestone dated exactly today's/the-latest ledger day?").
  This fires the pop once per mount when the latest ledger day happens to
  carry a milestone, and naturally never re-fires on a later visit once the
  latest date has moved past it — no localStorage ack needed for the chart
  dot specifically (unlike the goal card, which must never re-toast/re-pop
  across sessions once acked — the chart dot popping again on a later visit
  to a date that's no longer "latest" simply can't happen by construction).
  This is a deliberately simpler mechanism than threading `useGoalCrossing`'s
  ack state across components — flagged here explicitly as the chosen
  approach per this agent's "say so, don't leave it merely unstated" rule.

`motion.ts` gains one new export:

```ts
// motion.ts addition
export const SPRING_CONFIG_MILESTONE_POP = { type: "spring", stiffness: 420, damping: 18, mass: 0.6 } as const
export const SPRING_CONFIG_NUMBER = { type: "spring", stiffness: 180, damping: 22, mass: 1 } as const
```

Both gated by `usePrefersReducedMotion()` at the call site (not baked into
the config itself) — every consumer already imports that hook.

---

## 7. `animation.ts` — spring-based `useAnimatedNumber`

Public signature **unchanged**: `useAnimatedNumber(target: number, duration?: number): number`.
`Headline` (`JourneyWorkspace.tsx`) and `TodayPanel.tsx` both call it and
need zero changes.

```ts
// animation.ts — internals rewritten
import { useMotionValue, useSpring, useEffect, useState } from "motion" // useMotionValue/useSpring from "motion", useEffect/useState from "react"
import { usePrefersReducedMotion } from "./motion"
import { SPRING_CONFIG_NUMBER } from "./motion"

export function useAnimatedNumber(target: number, duration = 400): number {
  const reduced = usePrefersReducedMotion()
  const motionValue = useMotionValue(target)
  const spring = useSpring(motionValue, SPRING_CONFIG_NUMBER)
  const [display, setDisplay] = useState(target)

  useEffect(() => {
    if (reduced) {
      motionValue.set(target)
      setDisplay(target)
      return
    }
    motionValue.set(target)
  }, [target, reduced])

  useEffect(() => spring.on("change", setDisplay), [spring])

  return display
}
```

(Exact `motion` API surface — `useMotionValue`/`useSpring`/`.on("change", cb)`
— to be confirmed against the installed `motion@13.1.1` package's actual
typings during implementation; the pattern above is the standard
`motion`/`framer-motion`-successor idiom for a controlled numeric spring, but
`dashboard-react-engineer` should verify the exact hook names against
`node_modules/motion`'s type definitions once installed, since `motion`'s API
surface has moved around across major versions — this is called out as an
implementation-time verification step, not a blocking open dependency.)

`duration` param becomes vestigial (springs don't take a fixed duration) —
keep it in the signature for source compatibility with existing call sites
(`useAnimatedNumber(delta)` in `TodayPanel.tsx` doesn't pass it, so this is
low-risk) but it's unused internally; a code comment should say so plainly
rather than silently ignoring an argument.

The old eased-tween version (`requestAnimationFrame` + cubic ease-out) is
deleted entirely, not kept as a reduced-motion fallback path — reduced motion
here means "jump straight to target," identical in outcome to today's reduced-
motion behavior (`from === target || reduced` branch in the current file).

---

## 8. `JourneyWorkspace.tsx` — entrance stagger via `motion`

Replace the manual `Entrance` component (per-index `setTimeout` + CSS
transition classes) with `motion`'s declarative stagger. Since this file
currently renders `Entrance` as a plain wrapping `<div>`, the replacement
needs `motion`'s component API for the parent/child stagger relationship —
this is the one place in this spec that touches `motion/react`'s `<motion.div>`,
not just the core `animate()`/spring API. **This changes the import-size math
in §2** slightly: budget for it, don't pretend it fits the "mini core" import
path. Specifically:

```tsx
import { motion } from "motion/react"

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
}
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 26 } },
}

<motion.section variants={container} initial="hidden" animate="show">
  <motion.div variants={item}>{/* Headline */}</motion.div>
  {/* ...one motion.div per current Entrance-wrapped child... */}
</motion.section>
```

`prefers-reduced-motion` → pass `initial="show"` directly (skip `"hidden"`
entirely) when `usePrefersReducedMotion()` is true, rather than relying on
`motion`'s own (currently opt-in, version-dependent) reduced-motion handling —
explicit is safer than assuming a library default matches this app's a11y-spec.

**This is flagged, not silently absorbed:** §2's "~5-6KB mini core" estimate
in the direction doc was for items 1 and 2 (number springs, milestone pop)
only; item 3 (entrance stagger) needs `motion/react`'s heavier import for the
`<motion.div>`/`staggerChildren` API, which the direction doc itself priced
separately at ~18-20KB. **The real total for all three items together is
therefore closer to the direction doc's upper bound (~20-23KB) than its
lower bound** — confirm the actual `npm run build` delta and report it; do
not assume the smaller number without measuring.

---

## 9. `EmptyGlyph.tsx` — floor fix (Pulse §3, adopted per selection doc §4.5)

One shared component, ~12 lines of inline SVG (a dotted upward path fading
into a small ring), used in two places:

- `JourneyChart.tsx`'s `isEmpty` branch (`history.dates.length < 2`) —
  replaces the current plain-text `<div className="flex h-80 items-center
  justify-center text-xs text-muted-foreground">No history yet...</div>`
  with the glyph above the same text.
- `GoalMilestones.tsx`'s `goals.length === 0` branch — replaces the plain
  `<p>No goals yet...</p>` the same way.

```tsx
export function EmptyGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 40" className={className} aria-hidden="true">
      <path d="M4 34 Q 20 30 28 20 T 48 8" fill="none" stroke="var(--muted-foreground)"
            strokeWidth="1.5" strokeDasharray="3 3" strokeLinecap="round" opacity="0.6" />
      <circle cx="50" cy="8" r="5" fill="none" stroke="var(--chart-1)" strokeWidth="1.5" opacity="0.7" />
    </svg>
  )
}
```

`aria-hidden="true"` — the adjacent text carries the accessible meaning, the
glyph is decoration only (consistent with a11y-spec's chart-is-decoration
convention). No masking concerns (no money value in the glyph itself).

---

## 10. State matrix (every state × both themes × masked/unmasked)

| State | Behavior |
|---|---|
| **Loading** (`JourneyWorkspace`'s `HeroSkeleton`) | Unchanged — `Skeleton className="h-80 w-full"` inside a `Card`. Not affected by this round (still a plain skeleton, no shimmer/motion added — skeletons stay calm per round-2 convention). |
| **Error** | Unchanged — `ErrorState` component, untouched by this round. |
| **Empty** (`history.dates.length < 2`) | `EmptyGlyph` + existing text, no chart rendered, no range pills interaction needed (pills still render but are inert against empty data — same as today). |
| **Sparse** (2 ≤ points < 8) | §3.9 sparse mode: 220px height, no gridlines/Y-axis, inline point labels+dates, `DeltaChipRail` below. Path-morph duration 300ms. Warning line ("Only N data points...") — kept from the current file, unchanged text/placement. |
| **Dense** (≥8 points) | §3.9 dense mode: 320px height, gridlines + Y-axis + X-axis ticks, point labels only if ≤12 points (existing rule kept), no `DeltaChipRail`. Path-morph duration 400ms. |
| **Both themes** | Every color is a `var(--token)` reference (§0.4) — verify the raised area-gradient opacity (0.32 peak, §3.4) is visibly a wash, not a sliver, in `.dark` specifically (the audit's exact complaint) — this is a required visual QA step, not optional. |
| **Masked (privacy on)** | Y-axis ticks → `MASK_TEXT` (existing `formatYTick`), point labels suppressed (existing `!masked &&` guard, ported), tooltip value → `MASK_TEXT`, `DeltaChipRail` chip amounts → `MASK_TEXT` (percentages/counts stay visible — none appear in this chart's chips, they're pure ₹ deltas, so masked mode hides the whole chip's number but keeps the icon+date), milestone inline labels ("Crossed ₹1.00Cr") → suppressed entirely when masked (the label IS a money value; unlike the dot itself, which stays visible as a milestone marker with no number attached), aria-label on the chart container → the existing masked-vs-unmasked branch in `ariaLabel` (kept verbatim). |
| **Unmasked** | All of the above show real values, matching current behavior. |
| **Reduced motion** | Path morph → instant `d` swap (§3.5.5). Pulse ring → not rendered (§3.7). Milestone/goal spring pop → not rendered, element appears at final state with no animation (motion-spec has the exact per-interaction rule). Entrance stagger → `initial="show"` (§8). Number counters → jump to target (§7, `reduced` branch). |
| **Chart resize** (window/pane resize) | `useElementWidth` (§3.3) recomputes `xScale.range()` on `ResizeObserver` fire; re-render is a plain re-render, NOT a path-morph trigger (only `range` pill changes trigger the morph, per §3.5.6) — a resize should look like a static re-layout, not an animated tween. |

---

## Open dependencies

- **No contract/backend change required.** Every field this spec reads
  (`history.dates`, `.portfolioValueBase`, `.byGeography`, `.byPlatform`,
  `goals` via `useGoalsData()`) is already exported today.
- **Bundle budget is not formally re-baselined.** Round 2's spec set a
  +50KB-over-current total-app budget; this round alone (§0.5, §8) likely
  consumes the direction doc's full ~20-23KB estimate, and item 8's
  `motion/react` import may push toward the upper end. There is no current
  post-round-2 budget doc this can be checked against precisely (the same
  gap the direction doc flagged) — **run `npm run build` and report the
  actual raw + gzip delta to the user before considering this shippable**,
  since the user confirmed the ~20-23KB estimate, not an unmeasured actual.
- **`motion`'s exact hook API for `useAnimatedNumber` (§7) needs verification
  against the installed package's real typings** — the pattern given is
  standard for the library family but was not run against the actual
  installed `motion@13.1.1` package during spec-writing (design-only agent,
  no component code written). Flagged explicitly, not assumed correct.

## New dependencies added

| Package | Version | Approx. gzip | Why the existing stack can't do this |
|---|---|---|---|
| `@visx/shape` | `^4.0.0` | ~5-6KB (part of combined ~12-15KB visx group) | Low-level path/shape primitives with a render-prop escape hatch to the raw `d` string — Recharts doesn't expose this. |
| `@visx/scale` | `^4.0.0` | included above | Explicit scale control needed to drive the path-morph tween and the manual tooltip positioning (§3.8) outside Recharts' internal scale context. |
| `@visx/gradient` | `^4.0.0` | included above | Convenience wrapper over the same `<linearGradient>` SVG the current code already hand-writes — small win, bundled with the other two for one coherent visx surface rather than mixing hand-SVG and visx. |
| `d3-interpolate-path` | `^2.3.0` | ~2KB | The one capability this whole direction is chosen for — tweening between two arbitrary SVG path `d` strings; neither Recharts nor CSS can do this. |
| `@types/d3-interpolate-path` | `^2.0.3` | 0 (dev-only, types) | TS strict mode requires it since the package ships no bundled types. |
| `motion` | `^13.1.1` | ~5-6KB (core `animate`/spring path) **+ ~18-20KB if `motion/react`'s `<motion.div>` is used (§8 entrance stagger needs this)** | Spring physics with correct interruption handling (mass/stiffness/damping) — CSS keyframes can't react to a milestone re-firing mid-animation the way a spring naturally does. |
| **Total** | | **~20-23KB gzip** (confirm actual via `npm run build`, see Open Dependencies) | Matches the direction doc's own estimate — this spec does not exceed it, but §8 clarifies the entrance-stagger item is what consumes the upper end, not a padding margin. |

## Handoff note for `dashboard-react-engineer`

Build from this file (`docs/design/spec-round3/spec.md`) plus
`docs/design/spec-round3/tokens.json` (confirms zero new CSS tokens),
`docs/design/spec-round3/rationale.md` (why, for anything that reads as a
judgment call), `docs/design/spec-round3/accessibility/a11y-spec.md`, and
`docs/design/spec-round3/motion/motion-spec.md`. No other doc in `docs/design/`
needs to be open — this file names every file to touch (§1), every new
dependency at an exact version (§7), every token used (all reused, zero new,
per `tokens.json`), and the exact behavior for every state (§10, including
both themes and masked/unmasked).

Two things to verify empirically during implementation, both already flagged
above rather than left implicit: the real `motion` hook API for the number
spring (§7) against the actually-installed package, and the real bundle-size
delta against the ~20-23KB estimate (§0.5, Open Dependencies) — report both
back rather than assuming the spec's estimates were exact.

Suggested build order: (1) install deps + confirm `motion` API surface
against installed types; (2) rebuild `JourneyChart.tsx`'s plot on visx
(§3.1-3.4) with NO morph/glow yet, static parity check against current visual
baseline minus Brush/DayChangeStrip; (3) add path-morph (§3.5) + glow filter
(§3.6) + pulse ring (§3.7); (4) rewrite `MilestonePin.tsx` → halo dots (§5) +
wire tooltip (§3.8); (5) sparse/dense mode branch (§3.9) + `DeltaChipRail`
(§4); (6) `animation.ts` spring rewrite (§7) — verify `Headline`/`TodayPanel`
need zero changes; (7) `JourneyWorkspace.tsx` entrance stagger (§8) +
`GoalMilestones.tsx` crossing pop + chart halo pop wiring (§6); (8)
`EmptyGlyph` (§9); (9) full state-matrix QA (§10) both themes, both
masked/unmasked, `prefers-reduced-motion`, `npm run build` bundle check.
