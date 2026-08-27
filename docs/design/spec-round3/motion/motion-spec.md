# Motion Spec — Journey Redesign (Round 3, "Ascent")

Supersedes round 2's motion-spec **only** for the Journey chart / milestone /
number-counter / entrance surfaces this round touches. Round 2's "CSS
keyframes + ECharts built-ins ONLY, no Framer Motion" rule is explicitly
**lifted for this scope only** — the user confirmed the `motion` dependency
and its bundle cost (selected-direction doc §6). Every other screen in the
app is still CSS-only/ECharts-only motion, unchanged.

---

## 1. Entrance (`JourneyWorkspace` mount)

- `motion/react`'s `staggerChildren: 0.06` (60ms apart, matches round 2's
  original timing exactly) drives Headline → StalenessBanner → LiveJobsRow →
  JourneyChart → the TodayPanel/AccountRoads/GoalMilestones row → YearStrip.
- Each child: `{ opacity: 0, y: 12 }` → `{ opacity: 1, y: 0 }` via a spring
  (`stiffness: 300, damping: 26`) — NOT the manual `6px` rise the audit
  flagged as imperceptible (§1.4 of the audit: *"a 6px rise reads as 'the
  page loaded slightly wrong'"*). 12px, matching Pulse's own tuning
  recommendation (adopted here since both directions independently converged
  on "the current amount is calibrated too conservatively").
- `prefers-reduced-motion: reduce` → `initial="show"` (skip `"hidden"`
  state entirely, spec.md §8) — children render at final position on first
  paint, zero stagger delay.

## 2. Data refresh

- Headline total + `TodayPanel`'s day P&L: spring-driven via
  `useAnimatedNumber` (spec.md §7) — `SPRING_CONFIG_NUMBER = { stiffness: 180,
  damping: 22, mass: 1 }`. This produces a visible small overshoot-then-settle
  on a meaningful jump (e.g. a refresh that changes the total by a large
  amount), the "counting" feel the direction doc's user-POV story names
  explicitly. A same-value refresh (no change) produces no visible motion at
  all (matches current behavior — `from === target` short-circuits).
- Chart itself does not "refresh-animate" on a data refetch that doesn't
  change `range` — see spec.md §3.5.6 (path-morph is range-change-only, not
  a general data-change reaction). A refetch that changes the underlying
  values without a range change simply re-renders the path in its new shape,
  no tween (this matches the existing file's behavior — Recharts today also
  doesn't tween on refetch, only on the (currently broken/no-op) mount draw).

## 3. Interaction feedback

Unchanged from round 2 (`--shadow-md` hover lift, `--shadow-focus` ring,
button-press scale) — this round doesn't touch card/button-level interaction
motion, only the chart plot and the counters/entrance/milestone-pop items
enumerated here.

## 4. Journey-specific (this round's actual scope)

- **Range pill change:** path-morph, 400ms dense / 300ms sparse (spec.md
  §3.5, §3.9), eased with the token's own cubic-bezier values
  (`cubic-bezier(0.16, 1, 0.3, 1)` — reused numerically, not as a CSS
  `var()` reference, since `motion.animate()`'s `ease` option takes a
  bezier-array, not a CSS string: `[0.16, 1, 0.3, 1]`).
- **"Today" pulse ring:** pure CSS `@keyframes journey-pulse-ring`, 1.8s
  loop (unchanged cadence from Pulse's original spec), `r: 4→14, opacity:
  0.4→0`. Not `motion` — see rationale.md §6 for why.
- **Milestone halo pop (fresh crossing only, fires once):**
  `SPRING_CONFIG_MILESTONE_POP = { stiffness: 420, damping: 18, mass: 0.6 }`,
  scale `1 → 1.15 → 1`. Higher stiffness / lower damping than the number
  spring — this is a snappier, more percussive "pop" (a discrete celebratory
  event) vs. the number counter's smoother "settle" (a continuous value
  changing) — deliberately different spring characters for different kinds
  of events, both defined once in `motion.ts` and reused by both consumers
  (goal card, chart halo dot) so the two pops feel identical to each other
  even though they're triggered by different code paths (spec.md §6).
- **Mode cross-fade (dense↔sparse):** plain CSS opacity transition, 150ms,
  `motion-reduce:transition-none` — deliberately NOT `motion`-driven (no
  spring character needed for a binary layout swap).

## 5. Reduced motion (must pass QA)

See `accessibility/a11y-spec.md` §6 for the authoritative per-interaction
table — eight independently-gated rows, not one global switch. This file's
job is describing what each animation IS; the a11y spec's job is the
definitive reduced-motion behavior per row. Do not implement from this file
alone without cross-checking that table.

## 6. Performance rules

- `motion`'s spring values (`useMotionValue`/`useSpring`) update via
  `requestAnimationFrame` internally, same GPU-friendly transform/opacity
  discipline as round 2's rule — no `top`/`left`/`width` animation anywhere
  in this round's additions (path morph updates an SVG `d` attribute, which
  is unavoidably a layout-affecting property for a path — but it's a single
  `<path>` element, not a DOM-heavy tree, so the cost is bounded and
  comparable to what Recharts' own internal re-renders already did on every
  range change today).
- `IntersectionObserver` (`useInView`, unchanged) still gates the chart's
  initial mount — nothing in this round removes that gate.
- Total added bundle from motion in this round: ~20-23KB gzip (spec.md §7,
  §0.5) — this is materially larger than round 2's ~2KB motion budget and is
  the explicit, user-confirmed cost of this direction. Do not treat this
  line as a mistake if reviewed later; it's the point of choosing Ascent.
