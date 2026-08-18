# Accessibility Spec — Journey OS (Hybrid 2+3)

**Baseline:** WCAG 2.1 AA in BOTH themes. This supersedes the round-1 a11y spec.

---

## 1. Contrast (audit-critical, both themes)

| Token | Light | Dark | Fix vs current |
|---|---|---|---|
| `--loss` | `0.55 0.19 25` | `0.70 0.17 25` | dark: 4.2:1 → **5.3:1** |
| `--gain` | `0.52 0.14 155` | `0.74 0.14 155` | dark: 5.1 → 5.9:1 |
| `--warning` | `0.62 0.15 85` | `0.82 0.13 85` | dark: 7.2 → 7.8:1 |
| `--muted-foreground` | `0.47 0.012 285` | `0.68 0.012 285` | 12px labels now ≥4.5:1 (dark) / ≥4.5:1 (light) |
| `--primary` | `0.55 0.18 262` | `0.70 0.16 262` | brighter accent on dark |

QA: spot-check `--loss` on `--background` in devtools in BOTH themes; verify ≥4.5:1
for text, ≥3:1 for UI components/borders.

## 2. Semantic Structure

- One `<h1>` per workspace (sr-only if the visual hierarchy doesn't carry it):
  "Journey", "India", "US", "Returns", "Alerts", "Properties".
- Pane headers are `<h2>`; card titles `<h3>`.
- Landmark regions: `<header>` (Header), `<main>` (WorkspaceCenter),
  `<aside>` (UniversePane + ContextRail), `<footer>` (HealthTicker).
- Donut fallback: every donut has a visually-hidden `<table>` of
  label/value/pct (the data is never chart-only).

## 3. Keyboard Navigation

- **Universe table:** headers sortable via Enter/Space (`aria-sort`); arrow keys
  move row focus (roving tabindex); Enter opens the dossier; `aria-selected` on
  the active row; sticky header keeps `scope="col"` + `aria-sort`.
- **Pane collapse toggles:** focusable, `aria-expanded` + `aria-controls`.
- **CommandBar:** full keyboard (arrows, Enter, Esc), focus trapped while open,
  returns to the trigger on close.
- **AllocationLens slices:** focusable buttons with `aria-pressed` (filter
  state) + the hidden table as a fallback read.
- **Workspace switch:** segmented control is a tablist (`role="tab"`,
  `aria-selected`, arrow-key switching) — shadcn tabs provides this.
- **Dossier breadcrumb:** `←` back + `⌘0` shortcut; focus moves to the breadcrumb
  when a dossier opens.

## 4. Focus Management

- Visible `--shadow-focus` ring on every interactive element, both themes.
- Overlays (CommandBar, dialogs, sheets): focus trap + restore on close.
- Theme toggle: `aria-pressed`/menu semantics; `T` shortcut announces via toast
  or `aria-live`.
- No focus loss on refresh (focus stays on the refresh button; toast is
  `aria-live="polite"`).

## 5. Screen Reader Notes

- HealthTicker: `role="status"` with the summary line; per-platform dots have
  `aria-label` ("Zerodha fresh — as of 18 Aug 09:52 IST" / "Moomoo stale — 11
  days past threshold").
- Journey chart: `role="img"` + `aria-label` ("Net worth over time, from ₹X on
  <date> to ₹Y on <date>"); goals/milestones are ALSO readable as DOM list items
  (chart is decoration for SR users — the data lives in the list + hidden table).
- Delta counters: announce final value once (no mid-tick chatter) — `aria-live`
  on the container, debounced.
- Chat drawer: `role="log"` + `aria-live="polite"`; "agent offline" state
  announced.

## 6. Reduced Motion

- Global `@media (prefers-reduced-motion: reduce)` → `animation: none;
  transition: none` (one CSS rule + Tailwind `motion-reduce:` variants).
- ECharts: set `animation: false` on charts when the media query matches
  (check via `window.matchMedia` once, module-level).

## 7. QA Checklist (run in BOTH themes)

- [ ] Tab through every screen with no focus traps; focus visible at all times
- [ ] Universe table: sort via keyboard, arrow-nav rows, Enter opens dossier
- [ ] CommandBar opens with ⌘K and `/`, full keyboard nav, Esc closes + restores
- [ ] AllocationLens: each slice focusable, `aria-pressed` toggles filter
- [ ] Donuts have hidden tables; Journey chart has `role="img"` + accessible label
- [ ] HealthTicker announces via `role="status"`; stale platforms clearly labeled
- [ ] Privacy mask hides money/qty everywhere; percentages/counts stay visible
- [ ] `prefers-reduced-motion: reduce` → zero animation, everything reachable
- [ ] 12px `muted-foreground` labels ≥4.5:1 in both themes