# Motion Specification — Dashboard Revamp (Hybrid D1+D2)

**Principle:** *Motion carries information.* Every animation answers "what changed?" — nothing decorates. All timing uses the `--duration-*` / `--ease-*` tokens. `prefers-reduced-motion: reduce` disables ALL animation (durations → 0ms, no stagger, no transform).

---

## 1. Entrance (screen mount)

| Element | Duration | Easing | Stagger | Keyframes |
|---|---|---|---|---|
| OverviewCards (4) | 200ms | `--ease-out` | 80ms | `translateY(8px) → 0`, `opacity 0 → 1` |
| Donut cards (4) | 200ms | `--ease-out` | 80ms | same, after cards |
| TrendChart | 600ms | `--ease-out` | — | ECharts `animationDuration: 600` (line draw) |
| Table rows | 150ms | `--ease-out` | 20ms (cap 10 rows) | `opacity 0 → 1`, no transform (avoid CLS) |
| Alert rows | 200ms | `--ease-out` | 50ms | `translateY(4px) → 0`, `opacity 0 → 1` |

Implementation: CSS `@keyframes` + Tailwind `animate-*` utilities registered via `@theme`:
```css
@theme inline {
  --animate-enter: enter 200ms var(--ease-out) both;
  --animate-enter-up: enter-up 200ms var(--ease-out) both;
}
@keyframes enter { from { opacity: 0; } to { opacity: 1; } }
@keyframes enter-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
```
Stagger via inline `animationDelay` (max 5 items → max 400ms total).

---

## 2. Data Refresh (new snapshot → UI update)

| Element | Duration | Easing | Behavior |
|---|---|---|---|
| Stat card numbers | 400ms | `--ease-in-out` | Counter 0→value (requestAnimationFrame; `tabular-nums`; no layout shift) |
| Delta chips (dayPnl, 7d) | 300ms | `--ease-in-out` | Cross-fade old→new + `translateY(2px)` |
| TrendChart | 500ms | `--ease-out` | ECharts `animationDurationUpdate: 500` (morph) |
| Sparklines | 400ms | `--ease-out` | ECharts re-render with `animation` on |
| Refresh toast | in 300ms / hold 4s / out 200ms | `--ease-out` | `translateY(-8px) → 0`, `opacity`; `role="status"` `aria-live="polite"` |
| Stale badge | pulse ×3 | 2s total | `opacity 0.6 → 1` keyframe, 3 iterations, then steady |

---

## 3. Hover / Focus (interaction feedback)

| Element | Duration | Easing | Behavior |
|---|---|---|---|
| Card (interactive variant) | 120ms | `--ease-in-out` | `translateY(-2px)`, `--shadow-sm → --shadow-md` (transform+shadow only) |
| Table row | 120ms | `--ease-in-out` | `bg-accent/40` (existing) |
| Table header (sortable) | 120ms | `--ease-in-out` | `text-foreground` + `bg-accent/30` tint |
| Focus ring (all) | 0ms | — | `outline: 2px var(--ring); outline-offset: 2px` via `focus-visible` (instant — never animated) |
| Filter pill hover | 120ms | `--ease-in-out` | `text-foreground` |
| Command bar item hover | 80ms | `--ease-in-out` | `bg-accent/40` — fast = feels precise |

---

## 4. Cross-Filter (filter pills change results)

| Element | Duration | Easing | Behavior |
|---|---|---|---|
| Table rows | 200ms | `--ease-in-out` | Out: `opacity → 0.4`; reorder instantly; in: `opacity → 1` (no transform — avoids jump) |
| Sparklines | — | — | Persist (reuse element, no flicker) |
| Donut slices | 350ms | `--ease-out` | ECharts `animationDurationUpdate` (re-layout) |
| ReturnBars | 350ms | `--ease-out` | ECharts re-sort animation |

---

## 5. Command Bar

| Trigger | Duration | Easing | Behavior |
|---|---|---|---|
| Open (`⌘K`/`/`) | 150ms | `--ease-out` | `scale(0.98) → 1` + `opacity 0 → 1`, transform-origin bottom center |
| Type to filter | 80ms | — | Instant list reorder (no stagger — speed is the point) |
| Close (Esc) | 100ms | `--ease-in-out` | `opacity → 0`, `scale → 0.98` |

---

## 6. Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```
JS side: skip counters (set value instantly), skip stagger delays, ECharts options use `animation: false`.

---

## 7. Performance Rules

- Animate **only** `transform` + `opacity` (GPU-composited) — never `top/left/width/height/margin` except max-height expansion (rare).
- ECharts: `animation: true` only during data change; dispose mini sparkline charts when row scrolls out (`useInView` + `chart.dispose()`).
- No `will-change` left applied permanently — set during animation only, or omit (transform/opacity are cheap).
- Total JS budget for motion infra: ~2KB (CSS keyframes + counter util). No Framer Motion.