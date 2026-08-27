# Selected Direction — Journey Redesign (Round 3): "Ascent"

**Date:** 2026-08-27 · **Decision:** User selected **Direction 2 ("Ascent")** —
the bespoke `@visx`-based hero chart with path-morphing on range-pill switches
and spring-physics number counters via `motion`.

---

## 1. What's being decided here

Round 3 re-opens the Journey hero chart (`dashboard/src/components/journey/JourneyChart.tsx`
and its immediate neighbors) after the audit
(`docs/design/audit/2026-08-27-journey-redesign-audit.md`) found the current
chart reads as broken (raw unstyled `Brush`), dated (map-pin milestones, flat
single-hue stroke, imperceptible entrance motion), and mismatched to this
account's actual data shape (dense-chart chrome drawn over 3-4 real snapshots).
Three directions were drafted:

- **Direction 1 "Pulse"** — CSS-only depth/glow/sparse-mode fix, zero new deps.
- **Direction 2 "Ascent"** — bespoke `@visx` plot + `d3-interpolate-path` path
  morphing + `motion` spring physics. ~20-23KB gzip new deps.
- **Direction 3 "Chronicle"** — narrative `MomentStrip` timeline as the hero's
  co-equal element, Recharts stays, optional `embla-carousel`.

The user's explicit ask was *"i want complete redesign... best graphs charts
etc etc"* and, when presented with the three options and Ascent's real bundle
cost, **confirmed Ascent explicitly** — the highest-ceiling, highest-cost
option, chosen on its merits (best-looking chart) rather than lowest risk.

## 2. Why Ascent, referencing the audit and the direction doc

- Audit §1.1, §2 point at the *same* root defect from two directions: no
  depth/glow, and no mechanism to make range-pill switching feel intentional
  rather than a jump-cut. Direction 2 §2.1's path-morph (`d3-interpolate-path`
  tweening the SVG path `d` string between range changes) is the one thing
  neither Recharts nor CSS keyframes can do — it is a genuine capability gap,
  not a styling preference, which is why it justifies new dependencies where
  Direction 1's floor fixes don't need any.
- Audit §2 (external reference check) names "depth + a single glowing accent
  line" and "a pulse/halo on the latest point" as now table-stakes for
  premium fintech charts — Direction 2 §2.1's custom SVG `<feGaussianBlur>` +
  `<feMerge>` filter gives exact control over this that CSS `drop-shadow`
  approximates more crudely.
- Audit §1.5 flags the headline number as visually disconnected from the
  chart and the current `useAnimatedNumber` tween as a plain eased ramp, not
  a physics response. Direction 2 §2.2's `motion` spring integration is a
  drop-in internals swap (public hook signature `useAnimatedNumber(target):
  number` stays identical — every consumer is untouched) that produces the
  "settles with a small overshoot" feel used by Coinbase/Robinhood-style
  tickers, which is what "the number springs" in the user's own story
  (direction doc §1) describes.
- This is the landing screen of an app checked daily — the direction doc's
  own trade-off table (§4) is honest that the payoff is proportional to how
  often range pills are actually touched and values watched tick; the user
  accepted that trade knowingly.

## 3. Scope confirmation

**Journey workspace only** — `dashboard/src/components/journey/JourneyWorkspace.tsx`
and everything it composes (`JourneyChart`, `MilestonePin` → halo dot,
`GoalMilestones`, `AccountRoads`, `TodayPanel`, `YearStrip`, `MilestoneJournal`,
`animation.ts`, `motion.ts`). Portfolio / Allocation / Alerts / Properties /
Groww-Sharekhan Data screens are explicitly **out of scope**, exactly as
stated in all three direction docs and the audit's own scope line. No other
chart in the app (ECharts elsewhere, Recharts elsewhere) is touched — the new
`@visx`/`motion` surface is contained to the Journey hero chart and the
number-counter/entrance/milestone-pop interactions inside this one workspace.

## 4. Floor fixes folded in from Pulse and Chronicle (shared, not style choices)

Per the audit (§3, ranked root causes) and cross-references in Direction 2
itself (§2.1: *"Brush is removed, same reasoning as Direction 1 §2.1... Sparse/
dense mode split from Direction 1 §2.2 is adopted here too — this is a shared,
non-negotiable fix regardless of which direction is picked, since it's a
data-shape problem, not a style problem"*), the following are **defect fixes**,
not Direction 1/3 exclusives, and are mandatory parts of the Ascent build:

1. **Kill the `Brush` entirely** (Pulse §2.1 / Chronicle §2.1) — never
   load-bearing, currently renders as a broken opaque block. Range selection
   stays exactly the existing `1M/3M/6M/1Y/All` pills.
2. **Sparse vs. dense chart mode, computed from point count** (Pulse §2.2) —
   `SPARSE_THRESHOLD = 8` points. Dense mode = full axis/gridline treatment
   (restyled). Sparse mode = no gridlines, reduced height, glowing labeled
   endpoint dots.
3. **`DayChangeStrip`'s bar-chart replaced by a delta-chip rail** (Pulse §2.2,
   third bullet) for the sparse case — reuses the proven `AccountRoads`
   "number leads, icon + colored delta" pattern instead of an axis-based mini
   chart that renders mostly empty at low point counts (audit §1.3).
4. **Milestone pins become halo dots, not map-pin glyphs** (Pulse §2.5) — the
   audit (§1.1, §3 root cause #4) calls the teardrop pin a dated skeuomorphic
   idiom independent of which direction is picked. Direction 2 additionally
   gets a spring `scale` pop on a fresh crossing (its own addition on top of
   the shared halo-dot treatment).
5. **Empty states get a graphic, not plain muted text** (Pulse §3, Chronicle
   §2.3) — scoped to Pulse's lighter-weight inline `<EmptyGlyph>` (12-line SVG,
   no new dependency), not Chronicle's larger illustration set, since Ascent's
   dependency budget is already spent on `@visx`/`motion` and doesn't need a
   second "graphics" investment on top.

These are specified precisely in `docs/design/spec-round3/spec.md` alongside
the Ascent-specific work — they are not optional or deferred to a future round.

## 5. What's explicitly NOT being built from Pulse/Chronicle

- Chronicle's `MomentStrip` (horizontal moment-card timeline) is **not**
  adopted — it's a competing information-architecture bet (chart shrinks,
  narrative grows) that contradicts Ascent's bet (chart grows in visual
  weight and interaction quality). Building both would be incoherent.
- Chronicle's animated goal progress rings (replacing the `Progress` bar) are
  **not** adopted this round — out of scope, revisit only if a future round
  targets `GoalMilestones` specifically.
- Chronicle's larger 30-40-line empty-state illustrations are **not** adopted
  (see §4.5 above) — Pulse's smaller `<EmptyGlyph>` is used instead to keep
  the dependency/scope budget honest.

## 6. New dependencies (confirmed, see spec.md for exact versions)

`@visx/shape`, `@visx/scale`, `@visx/gradient`, `d3-interpolate-path`,
`@types/d3-interpolate-path` (dev), `motion` — combined ≈ 20-23KB gzip
runtime. Full versions, exact import paths, and the bundle-budget flag are in
`docs/design/spec-round3/spec.md` §0 and §7.

## 7. Next steps

1. **Spec package** → `docs/design/spec-round3/` (spec.md + tokens.json +
   rationale.md + accessibility/ + motion/) — implementation-ready, no other
   context required.
2. **Hand off to `dashboard-react-engineer`** per the spec's own handoff note.
3. Independent review at the end (structure, a11y, determinism, guardrails) —
   same pattern as round 2.
4. **Verification:** `npm run build` / `typecheck` / `lint` / `check:contract`,
   visual QA against real fixture data in both themes, `prefers-reduced-motion`
   pass, bundle-size delta check against the ~20-23KB budget.
