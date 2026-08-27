# Journey Redesign — Direction 1: "Pulse"

**Date:** 2026-08-27 · **Author:** dashboard-ui-designer · **Tagline:** *A chart
that looks alive at 3 points and at 300.*

**Cost class:** Low-risk, CSS-only. No new dependencies. Same libraries
(Recharts for the hero, plain SVG/CSS for everything else), same shadcn
primitives. The visual step-up comes from depth, glow, an adaptive sparse-data
mode, and turning up the motion the app already has infrastructure for.

---

## 1. Concept

The problem isn't Recharts, and it isn't the color tokens — it's that
`JourneyChart.tsx` draws one flat, un-glowing stroke and bolts on a
raw-unstyled `Brush` that reads as broken. **Pulse fixes the actual defects
first** (kill the Brush block, stop drawing dense-chart chrome over 3 data
points) and then adds the depth/glow/motion vocabulary that every modern
fintech hero chart uses — without adding a single new dependency, because
none of this requires one. Everything is a `<defs>` filter, a gradient stop,
and a CSS keyframe.

**User-POV story:** *"I open the app and the number ticks up with a soft
glow behind it. The line under it has a gentle pulse at today's point, like
it's still live. When I only have three snapshots, the app doesn't pretend
I have three months — it shows me a clean 'growing from ₹27.75L to ₹1.03Cr'
story instead of an empty axis grid. Nothing looks broken anymore."*

---

## 2. The chart redesign (primary target)

### 2.1 Kill the Brush, don't re-style it

Remove Recharts `<Brush>` entirely. Range selection stays exactly as it is
today — the `1M/3M/6M/1Y/All` pills — which is already a correct, modern
pattern (Linear/Vercel/Stripe all use pill/segment range controls, not
persistent brush bars). Drag-to-zoom was never load-bearing (nothing in
`JourneyWorkspace.tsx` or the contract requires it); dropping it removes the
single worst-looking element on the page for zero functional loss. This
alone fixes root-cause #1 from the audit.

### 2.2 Two chart modes, chosen by point count (not a config flag — computed)

```ts
// JourneyChart.tsx — new
const SPARSE_THRESHOLD = 8 // fewer than 8 points in the sliced range

const mode: 'sparse' | 'dense' = sliced.values.length < SPARSE_THRESHOLD
  ? 'sparse'
  : 'dense'
```

- **Dense mode** (≥8 points in the selected range): today's `ComposedChart`
  (Area + Line + gridlines + axes), but restyled per §2.3-2.5 below. This is
  the mode that will become the *default* experience once the ledger has
  months of history — build it to look great now so it doesn't need a 4th
  redesign later.
- **Sparse mode** (<8 points): drop the Cartesian grid, drop the Y-axis
  gridlines/ticks entirely, and drop fixed 320px height down to ~220px. Render
  the same Area+Line but with **large glowing endpoint dots labeled inline**
  (value + date directly on the chart, not hover-only — `LabelList` already
  does this for ≤12 points, keep and extend it to sparse mode specifically)
  and a single connecting line with the glow treatment from §2.4. Below the
  chart, replace `DayChangeStrip`'s bar chart (which is mostly empty at low
  point counts — audit §1.3) with a **horizontal list of labeled delta chips**
  (reuse the exact `AccountRoads` "number leads, icon + colored delta" pattern
  — proven, already the best-aged component on the page) — one chip per
  transition, "27 Aug +₹9,732", scrollable if many. This directly kills root
  cause #2 (dense chrome over sparse data) and root cause #3 (empty-looking
  bar chart) by replacing an axis-based mini chart with a compact,
  always-full stat rail.
- Both modes share the same card, header, and range pills — switching between
  them (e.g. picking "1M" on an account with 3 months of history if a shorter
  range happens to contain <8 points) is a data-driven state change, not a
  jarring re-skin: cross-fade the chart body 150ms on mode switch.

### 2.3 Depth: replace the flat 2-stop gradient with a real glow

```css
/* index.css — new keyframes/utility, no new tokens: reuses --chart-1 */
.journey-line-glow {
  filter: drop-shadow(0 0 6px color-mix(in oklch, var(--chart-1) 55%, transparent))
          drop-shadow(0 0 14px color-mix(in oklch, var(--chart-1) 25%, transparent));
}
```
Applied to the `<Line>` path via `style`. `color-mix()` is supported in all
evergreen browsers this app targets (a personal-laptop Electron/Chrome
context — no legacy browser constraint here). The area gradient gets a third
stop and a higher peak opacity (`0.32 → 0.08 → 0`) so it's actually visible in
dark theme, not just light. This is the single highest-leverage, lowest-cost
change for "looks flat" — a glow is ~3 lines of CSS, not a library.

### 2.4 The "today" point pulses

The last point on the line (today's value) gets a small looping CSS
`@keyframes pulse-ring` (a `::after`-style expanding-ring, 1.8s loop,
opacity 0→0.4→0, respecting `prefers-reduced-motion` → static dot). This is
the "it's alive" cue every reference dashboard (Robinhood, Coinbase, Mercury)
uses on a live/latest value point, and it's pure CSS on an SVG circle —
no dependency.

### 2.5 Milestone markers: halo dot, not a map pin

Replace `MilestonePin`'s teardrop SVG with a **ringed halo dot** — a filled
circle in `--chart-3` with a soft outer ring (`drop-shadow` blur, same
technique as §2.3) and, for the 1-2 most significant milestones only (crossing
a round number, all-time high), an inline floating label pinned above the dot
(`"Crossed ₹1.00Cr"` — reuse existing `deriveMilestones` text) instead of a
hover-only tooltip. This removes the dated skeuomorphic pin (root cause #4)
and makes milestones read as "the chart is celebrating this," not "a random
map marker landed here."

### 2.6 Increase (not add) motion — turn up what's already built

- `JourneyWorkspace.tsx`'s `Entrance` stagger: rise distance `6px → 12px`,
  add a subtle `scale: 0.98 → 1`, keep 300ms/60ms-apart timing. Small change,
  meaningfully more perceptible (root cause #5).
- `useAnimatedNumber` (headline + TodayPanel) already exists and works —
  extend its easing curve to slightly overshoot-and-settle (a `cubic-bezier`
  with a small overshoot, still CSS/JS math, no library) so the tick-up reads
  as a "counting" event, not a linear ramp.
- Chart line-draw keeps its existing `stroke-dashoffset` technique but the
  duration for sparse mode drops to 500ms (fewer points = should feel snappier,
  not slower) while dense mode keeps 800ms.

---

## 3. Beyond the chart — rest of the workspace

- **Headline ↔ chart color binding:** the big net-worth number gets a
  `text-shadow`/glow in `--chart-1` when day P&L is positive (same hue as the
  line), tying "the number" and "the line that produced it" together
  visually — currently they're unrelated (audit §1.5).
- **Empty states get a graphic, not just muted text.** `GoalMilestones`'
  "No goals yet" and the chart's "No history yet" both get a small inline SVG
  glyph (a simple line-icon illustration — e.g. a dotted upward path with a
  "+" target, built as one shared `<EmptyGlyph>` component, 12 lines of SVG,
  no asset files, no new dependency) instead of plain text. This is the
  "graphics" ask, scoped to where it actually helps (states that are
  currently just blank).
- **AccountRoads, TodayPanel, GoalMilestones, MilestoneJournal, YearStrip:**
  no structural change — they're functionally solid. Apply the same glow
  treatment (§2.3 technique) to `AccountRoads`' mini sparklines only, for
  visual consistency with the hero chart's new depth language.

---

## 4. Token diff

No new tokens required. Everything above is `color-mix()`, `drop-shadow()`,
and existing `--chart-*`/`--gain`/`--loss` values composed differently. This
keeps the redesign compatible with `spec-round2/tokens.json` without
modification, satisfying the "extend, don't replace" rule.

---

## 5. Trade-offs

| Trade-off | Assessment |
|---|---|
| Dropping Brush loses drag-to-zoom | Never used meaningfully at this data density; pills cover the real use case. Revisit only if history grows to years of daily data. |
| Sparse/dense mode adds a branch to maintain | Small, well-contained (`mode` computed from one `.length` check); pays for itself by not needing a 4th chart redesign once data grows. |
| Glow via `drop-shadow` has a (minor) paint cost | Negligible at this chart's element count (1 line, 1 area, <10 dots); not comparable to a canvas-heavy chart. |
| Least visually daring of the 3 directions | Correct trade for a daily-use finance tool — real depth/motion gains without theatrics or new bundle weight. If the user wants a bigger swing, see Direction 2. |

**Effort:** JourneyChart rewrite (Brush removal + two modes + glow) — M.
DayChangeStrip → delta-chip rail — S. Motion tuning (Entrance, animated
number easing) — S. EmptyGlyph component — S. **Total: ~1 focused session.**

---

## 6. New dependencies

**None.** Everything in this direction is CSS (`drop-shadow`, `color-mix`,
keyframes) and existing Recharts/shadcn primitives already in the codebase.
