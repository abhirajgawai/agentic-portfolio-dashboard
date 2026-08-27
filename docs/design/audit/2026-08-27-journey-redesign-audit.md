# Audit — Journey Workspace Redesign (Round 3)

**Date:** 2026-08-27 · **Author:** dashboard-ui-designer · **Scope:** Journey workspace
only (`dashboard/src/components/journey/JourneyWorkspace.tsx` and everything it
composes). Portfolio / Allocation / Alerts / Properties / Groww-Sharekhan Data are
explicitly out of scope for this round.

**User's verbatim ask:** *"i dont like the Graph on how we are showing our
application doesnt look morden and the graph is not clear at all, i dont want
update i want complete redesign of the landing screen, current looks very old not
morden at all. We add animation, graphics, best graphs charts etc etc"*

---

## 0. Context this round inherits

This is the **third** design pass over the Journey chart specifically:

1. **Round 2** (`docs/design/spec-round2/`) built the Journey OS shell and the
   original ECharts-based hero chart, under an explicit "no Framer Motion, CSS +
   ECharts only" bundle-budget constraint and a "calm by design, no confetti"
   philosophy (`spec-round2/rationale.md` §4, §10).
2. **2026-08-20 direction** (`docs/design/directions/2026-08-20-journey-shadcn-charts-direction-1.md`)
   migrated the chart from ECharts to Recharts/shadcn under a **"zero visual
   regression, faithful migration"** mandate — the doc literally states *"the
   current JourneyChart screenshot (ECharts) is the regression baseline. The
   shadcn version must match."* This shipped and is what's live today.

That framing is exactly why the user still calls it dated: two rounds of work
deliberately preserved the original chart's visual language instead of
questioning whether that language was ever modern. This round is explicitly told
NOT to do that — the user wants a real visual step up, not another faithful
migration.

---

## 1. What's actually live today (verified against running app, both themes)

Screenshots taken against the dev server at `http://127.0.0.1:5173`, both
`Dark` and `Light` theme, current seed data (54 holdings, ~₹1.03Cr, 3 real
history snapshots).

### 1.1 The hero chart is the #1 problem, and it's worse than "dated styling"

`dashboard/src/components/journey/JourneyChart.tsx` renders a Recharts
`ComposedChart` (Area + Line + Brush + ReferenceLine + custom pin markers) at a
fixed 320px height (`h-80`), for **"All"** range by default.

With this account's real data (3 distinct snapshot values: ₹27.75L → ₹1.03Cr →
₹1.03Cr, carried forward across ~4 days), the rendered chart is:

- A single kinked line with **two nearly-collinear segments** — visually
  indistinguishable from a single straight diagonal line jumping to a flat
  plateau. There is no "trend" to read; it's two data facts wearing a stock-chart
  costume.
- The **gradient area fill is essentially invisible** in dark theme (opacity
  0.18→0 over a near-black background reads as a near-imperceptible tint) and
  only faintly visible in light theme. The one piece of "graphic richness" the
  code already tries to deliver doesn't register.
- **Milestone pins** (`MilestonePin` — literal map-pin teardrop glyphs) float
  disconnected above the flat plateau, unlabeled until hover — they read as
  stray icons, not integrated chart annotations. Map-pin skeuomorphism is also
  a dated visual idiom (mobile-maps-2014), not what Stripe/Linear/Vercel-caliber
  dashboards use for chart annotations (they use rings, dots-with-halo, or small
  callout labels).
- On initial mount, the CSS `line-draw` entrance animation draws the line
  in from a `strokeDashoffset` — during the ~800ms draw, the chart shows a
  **stub of line near the bottom-left and two disconnected pins floating in
  empty space above** (captured directly — see mid-animation screenshot). This
  isn't a bug exactly (the animation does complete correctly), but it means the
  very first thing a user's eye catches on page load is a broken-looking
  half-drawn chart, every single time, on every visit. For a chart this sparse,
  and a session pattern this is "the landing page I check daily," that first
  400ms impression matters more than it would on a rich chart.

### 1.2 The `Brush` component is a genuine visual regression, not a subjective style gap

Directly below the chart sits a **full-height solid-color rectangle**
(`fill="var(--primary)" fillOpacity={0.08}` — but the rendered result at the
current viewport is a nearly opaque, un-textured block ~48px tall spanning the
full chart width) with two barely-visible drag handles. It reads as a UI
element that failed to render, not as a "drag to zoom" control. This is
Recharts' raw, unstyled `<Brush>` — the migration doc itself flagged this as
the biggest parity gap versus the old ECharts `dataZoom` slider
(`2026-08-20-...md` §4.1, §7: *"Brush is drag-to-select, not a persistent
slider... document in tooltip hint"*) and the hint was never added. Nothing in
the UI explains what this bar is or does. This single element is doing more
damage to the "modern" perception than any color or font choice — it's the
first thing below the fold that looks broken.

### 1.3 `DayChangeStrip` (the "Day-over-day change" mini bar chart) is mostly dead space

With only 1 real day-over-day delta in the current dataset, the 80px-tall bar
chart renders one small green bar near the left edge and a wide empty region
with just axis tick labels (`08-24` … `08-27`) — another chart-shaped element
that, for this account's actual data shape, is mostly blank chrome. Combined
with the chart + Brush above, the hero section spends **roughly 600–650px of
vertical space** (before any of TodayPanel/AccountRoads/GoalMilestones are
visible) to communicate what amounts to 3 numbers and 1 delta. That's the
structural root of "not clear at all" — it's not that the data is drawn
wrong, it's that a chart form built for rich multi-month series is being
applied to an account that currently has a handful of snapshots, and every
design decision (fixed 320px height, brush, day-strip) assumes the richer
case.

**This will improve organically as history accumulates** — but per the
design-philosophy precedent already set in this codebase
(`spec-round2/rationale.md` §3, §8: contract-honest, no fabricated data,
design for the data shapes that actually exist), the redesign needs a
**sparse-data-aware chart mode**, not just a prettier version of the
dense-data chart, because "not enough points yet" is going to be true for
months, and today's launch screen is the one making the first impression.

### 1.4 Visual language: technically-correct, expressively flat

- Single accent hue (`--chart-1`, a mid-saturation blue) used for line, dot,
  goal-adjacent affordances, and the Brush block — there is no visual hierarchy
  between "the thing I'm tracking" and "the UI chrome around it."
  Everything is the same blue.
  - The full 9-color `--chart-*` categorical palette (`index.css` lines 50–58,
  136–144) exists and is well-built (OKLCH, AA-checked both themes per
  `spec-round2/rationale.md` §9) but the Journey chart uses exactly one of
  those nine colors — it under-uses a palette the rest of the app invested in.
- No depth, glow, or layering — flat single-stroke line on a flat card on a
  flat page background. Compare this to any 2025-2026 reference dashboard
  (Linear Insights, Vercel Analytics, Mercury's account graph, Stripe
  Revenue): all of them use soft glow/blur under the active line, a richer
  multi-stop gradient, and often a subtle "current value" pulse or halo at the
  latest point — motion and depth cues that say "this is alive," not just
  "this is SVG."
- Range pills (`1M 3M 6M 1Y All`) are correct shadcn-style pill buttons —
  genuinely fine, no complaint here. Keep this pattern.
- Entrance stagger (`JourneyWorkspace.tsx` `Entrance` component, fade + 6px
  rise, 60ms apart) is subtle to the point of being nearly unnoticeable — on a
  16ms/60fps frame budget, a 6px rise reads as "the page loaded slightly
  wrong" more than "an animation happened." This is likely part of why the
  user doesn't perceive any motion at all despite motion code existing.

### 1.5 The rest of the Journey workspace (context, not primary target)

- **Headline** (`JourneyWorkspace.tsx` `Headline`) — big number + animated
  counter (`useAnimatedNumber`), clean, appropriately minimal. Not a complaint
  target, but currently visually disconnected from the chart below it — no
  shared color/glow language ties "the number" to "the line that produced it."
- **TodayPanel** — dense, information-rich, functionally strong (live polling,
  FX breakdown, movers). Visually it's a plain stacked list inside a card;
  fine for a data-dense panel, no motion, no visual distinction of
  positive/negative beyond text color.
- **AccountRoads** — already redesigned in a prior pass away from tiny
  sparklines toward stat-rows-with-small-spark (see its own doc comment); this
  is actually the **best-aged component on the page** — number-leads,
  sparkline-decorates, works at 2 or 200 points. It's a useful pattern to
  extend rather than replace.
- **GoalMilestones / MilestoneJournal** — functionally solid (real DB-backed
  CRUD, one-time toast on crossing), visually generic shadcn list-in-card.
  Currently shows an empty "No goals yet" state — first-run empty states across
  this workspace are all plain centered muted text, a missed opportunity for
  graphic warmth given the user explicitly asked for "graphics."
- **YearStrip** — a single centered line, fine, low-stakes.
- **LiveJobsRow / StalenessBanner** — utilitarian status rows, correctly low
  visual weight for their job (operational status, not the story).

### 1.6 Stack facts relevant to direction-setting

- Both `echarts` (`^6.0.0`, modular `echarts/core` per
  `dashboard/src/lib/charts.ts`) and `recharts` (`^3.8.0`) are dependencies.
  The Journey chart currently uses Recharts. Nothing here suggests Recharts
  itself is the blocker — `ComposedChart`/`Area`/`Line`/`ReferenceLine` all
  render correctly; the problems are **compositional and data-shape
  decisions** (what's drawn, at what density, with what chrome), not a
  library ceiling. A same-library redesign can fix essentially everything
  found above. A library swap is optional, not required, and should only be
  proposed where it earns its bundle cost (see directions).
- No `framer-motion` or other animation library is installed.
  `spec-round2/rationale.md` §4 explicitly rejected Framer Motion for bundle
  budget (~40-50KB gzip vs a 50KB total round-2 budget). That constraint's
  premise (very tight bundle budget, motion is secondary) is worth
  re-examining given the user's explicit "add animation" ask this round — but
  any recommendation to add a JS animation library must still name its real
  cost, per this agent's operating rules.
- Contract (`dashboard/src/types/contract.ts`) truth: `History` carries
  `dates`, `portfolioValueBase`, `byGeography`, `byPlatform` — no per-ticker
  time series, no benchmark series. Any direction that wants a benchmark
  overlay (NIFTY/S&P) or per-holding trend line is contract-blocked, same
  conclusion prior rounds reached.

---

## 2. External reference check

Quick scan of current (2025-2026) dashboard/fintech chart conventions
(Stripe Dashboard, Linear Insights, Vercel Analytics, Mercury, Ramp, plus
general dataviz-UX literature) confirms two things directly relevant here:

1. **Modern financial hero charts lean on depth + a single glowing accent
   line**, not multi-series clutter — soft blur/glow under the stroke, a
   richer gradient (not a single 18%→0% wash), and a pulse/halo on the
   latest point are now table-stakes for "premium" fintech charts, not
   optional flourish. This directly targets the "flat, no graphics" complaint.
2. **Sparse time-series data (roughly under 7-10 points) is a known, named
   UX problem** with an established alternative pattern: delta-forward
   summaries and milestone-forward layouts (big number + labeled deltas +
   sparkline decoration) instead of forcing a full axis/gridline/brush
   treatment meant for dense series. This validates redesigning the sparse
   case as a distinct mode rather than reskinning the dense-chart chrome.

Sources: [Line Chart UI Design Tips & Tricks](https://uxplanet.org/line-chart-ui-design-tips-tricks-b14f9d0f04bf),
[Dashboard Design UX Patterns — Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards),
[From Data To Decisions: UX Strategies For Real-Time Dashboards — Smashing Magazine](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/).

---

## 3. Summary of root causes (what the redesign must actually fix)

Ranked by contribution to "looks old / unclear":

1. **The Brush renders as a broken-looking solid block.** Highest-severity,
   lowest-ambiguity fix — this alone reads as a bug, not a style choice.
2. **Chart form assumes dense data; this account has sparse data.** No amount
   of re-skinning fixes a 320px axis-and-gridline chart drawing 3 points. Needs
   a genuinely different sparse-data mode.
3. **Zero depth/glow/motion-as-graphic-richness** — flat single-hue stroke on
   flat cards is the "old" visual language the user is naming, independent of
   the data-sparsity problem.
4. **Milestone pins are a dated, disconnected skeuomorphic idiom** — need a
   modern annotation treatment (glow ring / halo dot / inline callout).
5. **Entrance motion is present but imperceptibly subtle** — the app already
   has *some* animation infrastructure (`useAnimatedNumber`, CSS keyframes,
   `Entrance` stagger); the user experiencing "no animation at all" says the
   current amounts are calibrated far too conservatively for what was asked.
6. **Empty states (goals, day-change strip, short-history chart) are all
   plain muted text** — a missed opportunity given the explicit "graphics" ask.

Directions below address all six, at different levels of visual ambition and
cost.
