# Accessibility Spec — Journey Redesign (Round 3, "Ascent")

**Baseline:** WCAG 2.1 AA in BOTH themes, same as round 2's a11y-spec (this
supersedes it only for the Journey chart/milestone/counter surfaces touched
by this round — everything else in `docs/design/spec-round2/accessibility/a11y-spec.md`
still applies unchanged, e.g. CommandBar, HoldingsTable, HealthTicker).

---

## 1. Contrast

No new colors are introduced (`tokens.json` confirms zero new tokens) — every
color used by the rebuilt chart, halo dots, and delta chips is one of the
already-AA-checked round-2 tokens (`--chart-1`, `--chart-3`, `--gain`,
`--loss`, `--warning`, `--muted-foreground`, `--border`). No new contrast
audit is required; a spot-check against `.dark` is still worth doing for the
raised gradient opacity (spec.md §3.4 — a *visual* legibility check, not a
text-contrast one, since the gradient fill is decorative, not text).

## 2. Semantic structure

Unchanged from round 2 — the chart stays `role="img"` decoration, one `<h3>`
per card (`Journey`, `Goals`, etc.), landmark structure untouched by this
round (no shell changes).

## 3. Keyboard navigation

- **Range pills:** unchanged — `<button aria-pressed>` row, already keyboard-
  operable, tab order untouched by removing the Brush (the Brush was never
  keyboard-operable to begin with, so removing it is a net accessibility
  improvement, not a regression — it was a mouse-only drag control with no
  documented keyboard equivalent).
- **Manual tooltip (spec.md §3.8):** since the tooltip is now driven by
  `onPointerMove` on an SVG overlay rather than Recharts' built-in handling,
  it is **pointer-only by construction, same as the chart it replaces** (the
  current Recharts tooltip is also pointer-hover-only, no keyboard path
  exists today). This round does not regress keyboard access to the tooltip
  because none existed before — but it also does not add one. **Flagged
  explicitly, not silently unaddressed:** if a future round wants keyboard-
  navigable data-point inspection (e.g. arrow-key stepping through points
  with each one's value announced), that is new scope beyond this round,
  not a regression this round introduces.
- **Milestone halo dots:** decorative SVG elements, not separately focusable
  — same as the current pin implementation. The underlying data remains
  reachable via `MilestoneJournal`'s DOM list (unchanged, outside this
  round's scope) and via the chart's own `aria-label` summary.

## 4. Focus management

No new overlays/dialogs introduced by this round (the manual tooltip is
non-modal, follows pointer position, never traps focus). `GoalMilestones`'
existing dialog focus behavior is untouched.

## 5. Screen reader notes

- Chart `role="img"` + `aria-label` — unchanged pattern and unchanged
  computation (masked vs. unmasked branch, spec.md §10 table, last row).
- **Path-morph and spring number animations are purely visual** — no
  mid-animation state should ever be announced. `useAnimatedNumber`'s public
  contract (spec.md §7) still returns a single number per render; any
  `aria-live` region reading it (e.g. `TodayPanel`'s existing sr-only
  settled-value announcement) continues to announce only the *final* value,
  exactly as the round-2 a11y-spec §5 already requires ("announce final
  value once — no mid-tick chatter"). The spring's intermediate values must
  not leak into any `aria-live` text — verify this explicitly since a spring
  overshoots (goes slightly past target before settling), which if wired
  carelessly into a live region would announce a visibly "wrong" number
  mid-animation. The existing `settled` check in `TodayPanel.tsx`
  (`Math.abs(animatedDelta - dayPnlTotal) < 0.5`) already guards this — keep
  that guard, it becomes MORE important with a spring (which can overshoot
  the target, unlike the old ease-out tween which never exceeded it) not
  less.
- **Milestone/goal pop animation:** the crossed goal's `Badge`/label content
  doesn't change during the pop (only `scale` transforms) — no new text
  appears or disappears mid-animation, so no new `aria-live` concern beyond
  the existing crossing toast (unchanged, round-2 behavior).

## 6. Reduced motion — the definitive per-interaction table

| Interaction | `prefers-reduced-motion: reduce` behavior |
|---|---|
| Path morph on range change | Skipped — `d` attribute set directly to the target path, no tween (spec.md §3.5.5) |
| Area/line entrance | No draw-in (the old draw was already a silent no-op per spec.md §3.2's dead-keyframe finding — reduced motion here just means "stay that way on purpose" instead of "by accident") |
| "Today" pulse ring | Not rendered at all — static filled dot only (spec.md §3.7) |
| Milestone halo pop | Not rendered — dot appears at final `scale: 1`, no animation |
| Goal card crossing pop | Not rendered — `Badge` appears at final state, no scale animation (crossing toast itself still fires — informational, not decorative, same round-2 rule) |
| Number spring counters | Jump straight to target, no overshoot, no intermediate frames (spec.md §7 `reduced` branch) |
| Entrance stagger (`JourneyWorkspace`) | `initial="show"` passed directly — children render at final position immediately, no stagger delay, no rise (spec.md §8) |
| Mode cross-fade (dense↔sparse) | `motion-reduce:transition-none` — instant swap |

Every row above is independently gated by `usePrefersReducedMotion()` (not a
single top-level "disable everything" flag) — this matches the existing
codebase's granular pattern (already true of `line-draw`/`area-fade`'s
`reduced ? "none" : ...` checks in the current file) and must be preserved
per-interaction in the rewrite, not collapsed into one top-level branch that
could accidentally skip disabling one of the eight rows above.

## 7. QA checklist (run in BOTH themes, masked AND unmasked)

- [ ] Range pills: keyboard-operable exactly as before (unaffected by Brush
      removal)
- [ ] Chart `role="img"` + `aria-label` reads correctly, masked and unmasked
- [ ] `prefers-reduced-motion: reduce`: verify all 8 rows in §6 individually
      (don't spot-check one and assume the rest — each is a separate gate)
- [ ] `TodayPanel`'s sr-only live region announces the FINAL settled value
      only, even with the new spring's overshoot behavior — dev-tools
      throttle CPU or slow the spring temporarily during this check to catch
      any mid-animation announcement
- [ ] Milestone dots: hover reveals tooltip content (mouse-only, documented
      limitation per §3 above, not a regression)
- [ ] Privacy mask: money values hidden in axis ticks, point labels, tooltip,
      delta chips, milestone inline labels — percentages/dates/counts stay
      visible per the existing convention
- [ ] Sparse mode: inline point labels/dates readable at both default browser
      zoom and 200% zoom (WCAG 1.4.4) — verify they don't collide/overlap at
      the smallest expected point count (2 points)
