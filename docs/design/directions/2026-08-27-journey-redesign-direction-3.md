# Journey Redesign — Direction 3: "Chronicle"

**Date:** 2026-08-27 · **Author:** dashboard-ui-designer · **Tagline:** *Stop
drawing a stock chart. Tell the story the "Journey" name already promises.*

**Cost class:** Medium. One small, well-justified dependency (below). Same
chart library (Recharts stays), but the composition changes more than in
Direction 1 — the milestone timeline becomes a first-class layout element
sitting alongside the chart, not a hover-only annotation on top of it.

---

## 1. Concept

This workspace is already named and documented as "Journey" —
`spec-round2/rationale.md` §2 for the shell chose "land in the story, work
in the data" as *the single most important IA decision* of the whole OS. But
the actual chart component treats that story as a footnote: milestones are
tiny hover-only pins, the journal is a separate card below the fold, and the
chart itself is styled exactly like a generic stock-price widget. **Chronicle
closes that gap** — it makes the timeline of *this account's actual growth
events* (platform first-appearances, ₹10L crossings, biggest single-day
moves — all of which `journal.ts`'s `deriveMilestones`/`deriveJournalEntries`
already compute, deterministically, from real ledger data) the visual
spine of the hero section, with the line chart as connective tissue between
labeled moments rather than the whole point.

This is the direction that leans hardest into "graphics" from the user's
ask — not chart-physics graphics (Direction 2) or glow/depth (Direction 1),
but actual illustrative treatment: a horizontal moment-strip with small
iconography per milestone type, and animated progress rings replacing thin
goal bars.

**User-POV story:** *"Instead of a chart with some pins on it, I see a row
of moments: 'first ₹10L', 'Zerodha joined', 'crossed ₹1Cr, all-time high' —
each with a tiny icon and a date, laid out like a timeline. The line chart
sits above it, quieter, just showing the shape. Tapping a moment scrolls the
chart to it and highlights that point with a soft ring. My empty goal card
isn't just grey text — it's a dotted target ring waiting to be filled in."*

---

## 2. The chart redesign (primary target)

### 2.1 Chart shrinks in visual weight; the Moment Strip grows

- The line chart itself: same fixes as Direction 1 §2.1-2.4 (Brush removed,
  sparse/dense mode, glow line, pulsing "today" dot) — these are floor fixes
  every direction adopts, not unique to Chronicle. Height drops further in
  Chronicle specifically, to ~180px in sparse mode, because the milestone
  strip below is now carrying equal or greater visual weight, not
  decorating an otherwise-empty chart.
- **New: `MomentStrip`** — a horizontal, scroll-snap row of cards
  (`80px` tall, shadcn `Card`-adjacent styling, one per entry from
  `deriveMilestones`/`deriveJournalEntries`, deduped the same way
  `chartMilestones()` already dedupes in the current code) replacing both
  the current hover-only chart pins AND effectively subsuming
  `DayChangeStrip`'s job for sparse accounts (a delta *is* often a moment
  worth narrating, e.g. "Biggest gain: +₹47.72L" is already literal
  `MilestoneJournal` content today). Each card: a small type-specific icon
  (crossing = target ring, all-time-high = up-arrow-in-circle, platform
  joined = a small dot-and-line "connected" glyph — 4-5 simple line icons,
  built once as inline SVG, no icon-pack dependency beyond `lucide-react`
  already in use), the date, and the description text
  (`journal.ts` output, unchanged).
- **Chart ↔ strip linking:** clicking a `MomentStrip` card sets
  `tooltipLabel`/highlights the corresponding chart point with the same halo
  treatment as Direction 1 §2.5's milestone dots (shared implementation).
  This turns the chart and the journal — today two disconnected components
  (`JourneyChart` and `MilestoneJournal`, in different cards, one hover-only
  one click-to-manage) — into one coherent narrative unit. `MilestoneJournal`
  itself (the manage/delete dialog) stays exactly as-is lower on the page;
  `MomentStrip` is a new, glanceable, chart-adjacent summary of the same
  underlying data, not a replacement.

### 2.2 Goals become animated rings, not bars

`GoalMilestones`' thin `Progress` bar (`h-1.5`) becomes a small circular
progress ring (SVG `stroke-dasharray` arc, ~40px, animated fill on mount and
on value change via the same `ease-out` CSS the app already uses elsewhere —
no new dependency for this specific piece). This is a purely additive visual
upgrade to an already-solid component — same data (`progress()` math
unchanged), same card, same CRUD dialog.

### 2.3 Empty states get real illustration, not a glyph

Direction 1 proposed a small inline `EmptyGlyph`. Chronicle goes further:
build 2-3 purpose-specific empty-state illustrations (no goals yet, no
history yet, no milestones yet) as slightly larger, more considered inline
SVGs — a dotted upward path fading into a target ring for "no history",
a ring with a dashed "add" affordance for "no goals" — each ~30-40 lines of
SVG, still zero image assets, zero new dependency, but a genuine investment
in the "graphics" the user asked for, concentrated where the page currently
has literal blank space.

### 2.4 Motion: `react-intersection-observer`-driven reveal, `motion` optional

Chronicle's signature motion moment is the `MomentStrip` cards revealing
left-to-right as they scroll into view (most are visible without scrolling
at typical viewport widths, so this mostly fires once on load) — implementable
with the existing `useInView` hook (`JourneyChart.tsx` already imports
`./useInView` for lazy chart mounting; the exact same hook drives per-card
reveal here, zero new code pattern). Everything else motion-wise matches
Direction 1's tuned CSS approach (§2.6) — Chronicle's differentiator is
information architecture and illustration, not physics, so it does not need
Direction 2's `motion`/`visx`/path-morphing investment.

---

## 3. New dependency

**One, optional-but-recommended:** none are strictly required — the
`MomentStrip` scroll-snap row can be built with plain CSS
`scroll-snap-type`. The one library worth considering is `embla-carousel`
(**~6KB gzip**, headless, React-friendly, actively maintained, already the
de facto shadcn-ecosystem choice for shadcn's own `carousel` block) *only if*
`dashboard-react-engineer` finds the raw CSS scroll-snap approach fights
keyboard navigation (arrow-key stepping between moments) — flag this as an
implementation-time judgment call, not a hard requirement. If plain
CSS scroll-snap + manual `tabIndex`/arrow-key handling covers it (likely,
given the strip rarely exceeds ~10-15 cards), **ship with zero new
dependencies.**

---

## 4. Beyond the chart

- **AccountRoads, TodayPanel, YearStrip:** unchanged, same reasoning as
  Direction 1 §3 (already solid, not a redesign target).
- **MilestoneJournal:** unchanged in function; visually now the "detail/manage"
  view underneath the new glanceable `MomentStrip` summary — a sensible
  progressive-disclosure split (strip = at-a-glance, journal card = full
  list + delete), not a duplication.

---

## 5. Trade-offs

| Trade-off | Assessment |
|---|---|
| New layout element (`MomentStrip`) is more implementation surface than Direction 1's pure re-style | Genuinely serves the "Journey" narrative identity this app already committed to at the IA level (round-2 rationale) — this direction finishes a story the codebase started, rather than adding a new one. |
| Risk of "graphics creep" (icons/illustration scope expanding) | Bounded explicitly in §2.3 to 2-3 empty states + 4-5 moment-type icons, inline SVG only, no asset pipeline, no icon-pack dependency. |
| Slightly reduces the hero line chart's dominance vs. Directions 1/2 | Deliberate — the audit found 3 real data points don't deserve 320px of chart real estate; redistributing weight to the moment strip uses that space for content that's actually rich (the journal already has 6 real entries in current data) instead of empty axis chrome. |
| Doesn't deliver Direction 2's "premium path-morph" wow moment | Different kind of "impressive" — narrative depth and illustration vs. physics polish. Pick based on which reads as "modern" to the user: a chart that feels expensive, or a page that feels like it's telling their story. |

**Effort:** Chart floor-fixes (shared with Direction 1) — M. `MomentStrip`
component + chart-linking — M. Goal rings — S. Empty-state illustrations —
S. **Total: ~1.5-2 focused sessions.**

---

## 6. New dependencies (summary)

None required. `embla-carousel` (~6KB gzip) is a conditional, implementation-
time option only if plain CSS scroll-snap proves insufficient for keyboard
accessibility on the `MomentStrip` — see §3.
