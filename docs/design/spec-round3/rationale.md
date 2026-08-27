# Rationale — Journey Redesign (Round 3, "Ascent")

Companion to `spec.md`. Explains *why* each non-obvious call was made, for
anyone reviewing the spec or picking it back up later.

---

## 1. Why rebuild only the plot, not the whole `JourneyChart.tsx` shell

The header, range pills, and card chrome are already correct per the audit
(§1.4: *"Range pills... genuinely fine, no complaint here. Keep this
pattern."*). Rebuilding working, well-reviewed UI just because the plot
underneath changed libraries would be scope creep with no user-visible
benefit and real regression risk (the pill interaction, `aria-pressed`
wiring, and `Custom`-range removal are all independently testable surface
that doesn't need to move).

## 2. Why `curveLinear`, not a smoothed curve, survives into the visx rebuild

This is inherited, not re-derived: the current file's code comment on
`type="linear"` states the honesty rule directly — carried-forward snapshot
values must never imply interpolated data between real data points. Visx
makes curve choice explicit (`curveLinear` from `@visx/curve`) rather than a
Recharts string prop, which if anything makes this constraint easier to spot
in review (a `curveLinear` import literally sitting in the file), not harder.

## 3. Why the path-morph duration differs by mode (400ms dense / 300ms sparse)

Two independent sources agree on this ratio without knowing about each
other: Direction 2 itself specifies 400ms for the morph without a sparse-mode
carve-out, while Direction 1 (§2.6, adopted here as a floor fix) separately
tunes the *draw* animation from 800ms dense to 500ms sparse on the reasoning
that "fewer points = should feel snappier." Applying that same ratio to the
morph (which fills the role the draw animation used to fill, now that the
draw animation itself is gone per §3.2's dead-keyframe finding) keeps the
"snappier for less data" principle consistent across the redesign rather than
having two unrelated timing systems.

## 4. Why the chart halo-dot "just crossed" pop doesn't reuse `useGoalCrossing`

`useGoalCrossing` (in `GoalMilestones.tsx`) answers a *goal-specific,
cross-session* question: "has this exact goal, identified by its stable DB
id, ever been acked as crossed before, in this browser?" That's the right
model for a goal card, which must never re-toast on a later visit.

A chart milestone dot answers a *ledger-specific, single-render* question:
"does today's rendered chart happen to include a milestone dated the most
recent ledger day?" That's naturally idempotent across sessions without any
ack bookkeeping — once the ledger has moved past that date, "most recent
ledger day" points somewhere else and the pop simply doesn't fire for that
now-older milestone. Threading `useGoalCrossing`'s ack state (goal-keyed,
localStorage-backed) into a milestone-keyed (not goal-keyed at all — chart
milestones are ledger crossings/ATHs/recoveries, not user-defined goals)
context would mean inventing a parallel ack scheme for a different kind of
entity, for no benefit over the simpler date-comparison approach. This is
flagged explicitly in spec.md §6 as the chosen approach specifically because
Direction 2's own text ("reuses the existing `useGoalCrossing` ack logic")
reads as if one mechanism covers both, and on inspection it only cleanly
covers the goal-card case.

## 5. Why `EmptyGlyph` (Pulse's smaller treatment) instead of Chronicle's
   illustration set

Ascent's dependency budget (§0.5, §7 of spec.md) is already the largest of
the three directions specifically because path-morphing and spring physics
are worth paying for. Chronicle's 30-40-line illustration set was justified
in its own direction doc (§2.3) as *"a genuine investment in the 'graphics'
the user asked for"* — but Chronicle didn't also need to fund `@visx`/
`motion`. Spending more implementation effort on empty-state illustration on
top of the visx/motion investment double-spends the "graphics" ask against
the same budget Ascent already allocated to the chart itself, which is where
the user's complaint was actually concentrated (audit §1.1-1.3 are entirely
about the chart; empty states are audit §1.5/§3 root cause #6, explicitly
the lowest-ranked root cause). Pulse's 12-line glyph satisfies "not just
plain muted text" without competing for scope against the chart rebuild.

## 6. Why the pulse ring (§3.7 of spec.md) is CSS, not `motion`

Not every animation in this round needs `motion` — the "today" pulse ring is
a simple, non-interactive, infinitely-looping radius/opacity animation with
no state to react to (it never gets interrupted mid-cycle by new data the
way a spring-driven number does). CSS `@keyframes` handles this exactly as
well as a JS library would, at zero additional bundle cost. Using `motion`
for it anyway would be reaching for the new tool because it's there, not
because CSS can't do the job — the same discipline the direction doc itself
applies when distinguishing what needs real spring physics (interruption-
aware: numbers, milestone pops) from what doesn't (a static loop).

## 7. Why `motion/react`'s heavier import is flagged rather than avoided

The direction doc priced the "mini core" (~5-6KB) against items 1-2 (number
springs, milestone pop) specifically, and separately noted `motion/react`'s
full API costs ~18-20KB. Item 3 (entrance stagger via `staggerChildren`) is
inherently a parent/child declarative relationship — `motion`'s core
`animate()` API is imperative and doesn't model "animate these N children in
sequence" without either manually orchestrating N separate `animate()` calls
(hand-rolling what `staggerChildren` gives for free, at high implementation
cost for a fairly cosmetic feature) or accepting the `motion/react` import.
This spec chooses the latter and says so plainly in §8, rather than silently
implying entrance stagger fits inside the smaller budget — a design decision
made silently is exactly what this agent's operating rules warn against.

## 8. Why the manual `ResizeObserver`/tooltip work (§3.3, §3.8 of spec.md)
   isn't itself flagged as risky

`ResponsiveContainer` and Recharts' built-in tooltip cursor-tracking are
convenience wrappers around exactly this kind of `ResizeObserver`/pointer-
math code — reimplementing them at low-level is more code, not more risk,
because the behavior being replicated (resize triggers a re-measure; pointer
position maps to nearest data point) is well-understood and already visible
in how the current file uses `<Tooltip>`. This is the accepted cost of
"purpose-built low-level toolkit" the direction doc chose over "general-
purpose chart library defaults" (direction doc §1) — visx trades convenience
for control on purpose, and control is exactly what path-morphing needs.
