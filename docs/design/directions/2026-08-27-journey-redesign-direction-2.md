# Journey Redesign — Direction 2: "Ascent"

**Date:** 2026-08-27 · **Author:** dashboard-ui-designer · **Tagline:** *The
chart the user asked for: the best one, on purpose.*

**Cost class:** Highest of the three. Adds two small, targeted dependencies
(below) to buy genuine capability Recharts/CSS can't: smooth path morphing
between range changes, custom SVG filter effects, and physics-based motion.
This is the direction to pick if "best graphs charts" is meant literally —
a hero chart built with a purpose-built low-level toolkit, not a
general-purpose chart library's defaults.

---

## 1. Concept

Direction 1 ("Pulse") fixes every defect using only what's already installed.
Ascent asks a different question: *if this chart is the single most-viewed
element in the whole app (it's the landing screen), what does it look like
if we stop treating it as "a Recharts ComposedChart with props" and build it
as a bespoke, physics-animated centerpiece?* This means dropping down to
`@visx` (React bindings over d3's primitives — scales, shapes, gradients,
curve interpolators) for the hero chart specifically, so range-pill switches
smoothly **morph the existing path into the new one** (d3 path interpolation)
instead of cross-fading, and so custom SVG filters (turbulence-free glow,
gradient blur) are first-class instead of CSS `drop-shadow` approximations.

**User-POV story:** *"I tap '1M' and the line doesn't just swap — it flows
into its new shape, like the data is reshaping itself in front of me. The
glow under it breathes. When my portfolio crosses a milestone, the number
doesn't just change color, it springs — a tiny satisfying bounce, then
settles. This feels like a product someone spent real time on."*

---

## 2. The chart redesign (primary target)

### 2.1 Rebuild `JourneyChart`'s plot on `@visx/shape` + `@visx/scale` + `@visx/gradient`

Keep everything **around** the chart unchanged: the `Card`, header, range
pills, privacy masking, `useGoalsData`, `deriveMilestones`, `sliceHistory` —
all pure data/logic, reused as-is. Only the SVG plot area (currently
`ComposedChart` and its children) is rebuilt on visx primitives:

- `@visx/scale` (`scaleLinear`, `scaleTime`) replaces Recharts' internal
  scale — same math, explicit control.
- `@visx/shape`'s `AreaClosed` + `LinePath`, with `curveLinear` (matches the
  existing "carried-forward, no false smoothing" honesty requirement —
  `JourneyChart.tsx`'s current doc comment on `type="linear"` is preserved,
  just implemented at a lower level).
- `@visx/gradient`'s `LinearGradient` for the fill — same visual intent as
  today's `<linearGradient>`, just composed via visx's helper.
- **Path morphing on range change:** react-spring or visx's own
  `@visx/mock-data`-adjacent animation utilities aren't needed for this —
  use `d3-interpolate-path` (tiny, ~2KB gzip, does exactly one thing: tween
  between two SVG path `d` strings) driven by the small `motion` dependency
  below. When the range pill changes, the old path interpolates into the new
  one over 400ms instead of the chart re-mounting/cross-fading. This is the
  single most "premium dashboard" interaction in this whole direction — it's
  what makes Linear Insights and Vercel Analytics charts feel expensive, and
  neither Recharts nor CSS can do it without exactly this kind of path-tween
  primitive.
- **Custom SVG filters** for the glow (an actual `<feGaussianBlur>` +
  `<feMerge>` filter def, reused for the line, the "today" pulse ring, and
  milestone halos) — more control over blur radius/spread than CSS
  `drop-shadow`, and reusable as one `<defs>` block.
- Brush is removed, same reasoning as Direction 1 §2.1 (never load-bearing,
  reads as broken today). Sparse/dense mode split from Direction 1 §2.2 is
  adopted here too — this is a shared, non-negotiable fix regardless of
  which direction is picked, since it's a data-shape problem, not a style
  problem.

### 2.2 `motion` (small React animation library) for the physics layer

Add the `motion` package (the actively-maintained successor to Framer
Motion, published under the name `motion` — NOT the old `framer-motion`
name, which is now a re-export shim) for exactly three interactions that
CSS keyframes genuinely cannot do well:

1. **Spring-based number counting** on the headline net-worth figure and
   `TodayPanel`'s day-P&L — replaces `useAnimatedNumber`'s current linear/
   eased tween with a real spring (mass/stiffness/damping), which is what
   produces the natural "settles with a tiny overshoot" feel used in
   Coinbase/Robinhood-style tickers. `useAnimatedNumber`'s public interface
   (returns a number) stays identical — only its internals change, so
   every consumer (`Headline`, `TodayPanel`) needs zero changes.
2. **Milestone-crossing celebration:** when `GoalMilestones`/the chart
   detects a fresh crossing (reuses the existing `useGoalCrossing` ack
   logic — no new detection code), the crossed goal card and the
   corresponding chart halo dot both get a spring `scale` pop
   (1 → 1.15 → 1) instead of the current instant Badge appearance. Bounded,
   tasteful, fires once (already de-duped by the existing ack mechanism) —
   this is the closest this direction gets to "celebration," deliberately
   short of the confetti round-2 explicitly rejected.
3. **Entrance stagger**, replacing `JourneyWorkspace.tsx`'s manual
   `setTimeout`+CSS-class `Entrance` component with `motion`'s
   `staggerChildren` — same visual outcome as Direction 1's tuned version,
   but declarative and gets spring physics on the rise for free.

`motion`'s tree-shaken "mini" animation core (the subset used here — spring
values, `AnimatePresence` for the mode cross-fade fallback, basic
`animate()`) is documented at roughly **~5-6KB gzip**; pulling in
`motion/react`'s full component API (`<motion.div>` JSX, gestures, layout
animation) is closer to **~18-20KB gzip**. This direction only needs the
imperative `animate()`/spring-value API (no drag gestures, no layout
animation), so implementation should import from the smallest entry point
that covers items 1-3 — call this out explicitly to
`dashboard-react-engineer` as a build-time budget check, not an assumption.

### 2.3 New dependency cost table

| Package | Purpose | Approx. gzip | Why existing stack can't do this |
|---|---|---|---|
| `@visx/shape`, `@visx/scale`, `@visx/gradient` | Bespoke hero chart primitives | ~12-15KB combined (tree-shakeable, per-package) | Recharts owns its own scale/path internals — there's no supported way to intercept the rendered path `d` string mid-render to feed it to a path-tween library. Need low-level control of the actual SVG. |
| `d3-interpolate-path` | Path morphing between range changes | ~2KB | Neither Recharts nor CSS can tween between two arbitrary SVG path shapes; this is the one thing that makes range-switching feel "premium" instead of "swapped." |
| `motion` (mini/core subset) | Spring physics: number counters, milestone pop, entrance | ~5-6KB (core subset only, not `motion/react` full) | CSS keyframes can approximate easing curves but not true mass/spring/damping physics reacting to real interruption (e.g. a milestone re-fires mid-animation) — springs handle interruption correctly by design, keyframes don't. |
| **Total** | | **~20-23KB gzip** | Against round-2's original 50KB *total* motion+feature budget — this direction alone would consume most of a budget sized for the whole app. Flag this explicitly to the user as the cost of "best chart, literally." |

---

## 3. Beyond the chart — rest of the workspace

Same component-level treatment as Direction 1 §3 (empty-state glyphs,
AccountRoads glow, headline↔chart color binding) — those don't depend on
which chart-rebuild path is chosen, and `motion`'s spring entrance covers
the stagger for all of `TodayPanel`/`AccountRoads`/`GoalMilestones` for
free once it's wired at the `JourneyWorkspace` level.

---

## 4. Trade-offs

| Trade-off | Assessment |
|---|---|
| Real bundle cost (~20-23KB gzip) | The honest price of "best chart" — this is the direction to pick only if the user confirms that trade explicitly after seeing the number. |
| Two new library surfaces to learn/maintain (`visx`, `motion`) | Both are best-in-class, actively maintained, widely used in production fintech dashboards (visx is built by Airbnb's viz team; motion is the direct successor to the most widely-used React animation library). Not experimental risk, but still new surface area vs. Direction 1's zero-new-deps. |
| Path-morph + spring physics only pay off with real interaction (range switching, live updates) | Highest ceiling of the three directions, but the payoff is proportional to how often the user actually switches ranges/watches values tick — worth confirming that's a real daily behavior, not just a demo moment. |
| Hero chart now has different internals from every other chart in the app (still ECharts/Recharts elsewhere) | Contained by design — only `JourneyChart.tsx`'s plot area changes; this doesn't ask other workspaces (out of scope this round) to follow. |

**Effort:** visx plot rebuild + path morphing — L. `motion` integration
(number springs, milestone pop, entrance) — M. Sparse/dense mode + Brush
removal (shared with Direction 1) — M. **Total: ~2-3 focused sessions** —
meaningfully larger than Direction 1.

---

## 5. New dependencies (summary)

`@visx/shape`, `@visx/scale`, `@visx/gradient`, `d3-interpolate-path`,
`motion` — see cost table in §2.3. Combined ≈ 20-23KB gzip, the largest ask
of the three directions; must be confirmed against the app's actual bundle
budget before implementation (no current budget doc exists post-round-2 that
this can be checked against precisely — flag as an open dependency).
