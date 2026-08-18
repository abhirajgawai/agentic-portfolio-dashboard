# Motion Spec — Journey OS (Hybrid 2+3)

**Rule:** CSS keyframes + Tailwind `animate-*` + ECharts built-ins ONLY. No Framer
Motion. `prefers-reduced-motion: reduce` disables ALL animation (opacity-only, 0ms
or 150ms max, no transform, no pulses, no draw).

---

## 1. Entrance (workspace mount)

- Journey workspace: hero chart draws 800ms ease-out (ECharts built-in); side
  cards (Today / Roads / Goals) stagger 60ms each, fade + 6px rise, 300ms
  `--ease-out`.
- Other workspaces: 150ms fade of the center container (keyed re-render).
- Universe pane: rows fade in 200ms on first mount only (not on filter).

## 2. Data Refresh

- Refresh → numbers tick (delta counter) 400ms on visible amounts (TodayPanel,
  total headline, table value column).
- Health ticker: fresh dots pulse once (green) 300ms; toast slides up + auto-
  dismisses 4s (sonner default).
- Charts: ECharts built-in morph 500ms when data changes.

## 3. Interaction Feedback

- Hover: card lift via `--shadow-md` + 2px up, 150ms; table row tint 100ms.
- Focus: `--shadow-focus` ring, 100ms (never removed on keyboard).
- Button press: scale 0.98, 100ms (reduced-motion: none).

## 4. Cross-Filter (AllocationLens)

- Donut selection: selected slice keeps full opacity, others dim to 40%, 200ms
  (ECharts built-in `emphasis`); table rows re-sort with a keyed re-render
  250ms (CSS FLIP-style via layout change, no library).
- Clear filter: reverse, 200ms.

## 5. Command Bar (⌘K)

- Open: scale 0.98→1 + fade, 150ms `--ease-out` (shadcn command default).
- List filtering: instant (no animation — typing must feel immediate).
- Close: fade 100ms; focus returns to the ⌘K trigger.

## 6. Journey-Specific

- Range pill change (1M/3M/6M/1Y/All): dataZoom morph 400ms (ECharts).
- Goal crossing: one-time sonner toast + a card slides in 300ms; no confetti.
- Milestone marker appears with a soft ping (scale 1→1.1→1, 400ms) once;
  reduced-motion: no ping, marker just renders.

## 7. Theme Switch

- `body` transition on background/color 200ms `--ease-in-out`; charts re-render
  with new palette (ECharts `theme` rebuild, no cross-fade needed — palette
  change is instant, which is correct).

## 8. Reduced Motion (must pass QA)

- Every animated element checkable: `@media (prefers-reduced-motion: reduce)`
  sets `animation: none; transition: none` globally (Tailwind `motion-reduce:`
  variants + one CSS rule). Toasts still appear (they're information, not
  decoration) but without slide.

## 9. Performance Rules

- Only `transform` + `opacity` animated (GPU-friendly). No `top/left/width`
  animation except ECharts internal.
- IntersectionObserver gates chart/sparkline mounts; nothing animates off-screen.
- Total added bundle from motion: ~2KB (CSS keyframes), ECharts built-ins reuse
  the existing core chunk.