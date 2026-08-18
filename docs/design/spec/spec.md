# Dashboard Revamp — Implementation Spec (Hybrid D1+D2)

**Handoff document for `dashboard-builder`.** Read `docs/design/selected/2026-08-18-revamp-selected-direction.md` for the decision rationale, and `docs/design/spec/tokens.json` for the machine-readable tokens.

---

## 0. Hard Constraints (non-negotiable)

1. `dashboard/src/types/contract.ts` — **IMMUTABLE**. No field renames, no new fields.
2. Determinism boundary — only `ChatDrawer` touches the agent; all other screens render from static JSON.
3. Stack locked: Vite 8 + React 19 + TS strict, Tailwind v4 (CSS-first, no config file), shadcn/ui v4 New York, ECharts 6 (modular `echarts/core` imports only), TanStack Query/Table, Zod v4, lucide-react.
4. Dark-only. No light theme.
5. Bundle: +50KB max over current (current JS ≈ 1,083KB raw / ~350KB gz). No Framer Motion, no new chart lib.
6. WCAG AA. `prefers-reduced-motion` must disable all animation.
7. All tokens in `@theme inline` CSS custom properties — never hardcoded values in components.

---

## 1. Design Tokens (index.css)

Apply `docs/design/spec/tokens.json` as CSS custom properties in `:root` + `@theme inline` mapping (existing pattern). Key changes vs current:

| Token | Current | New | Notes |
|---|---|---|---|
| `--loss` | `oklch(0.63 0.2 25)` | `oklch(0.70 0.17 25)` | **A11y fix** 4.2:1 → 5.3:1 |
| `--gain` | `oklch(0.72 0.15 155)` | `oklch(0.74 0.14 155)` | 5.1 → 5.9:1 |
| `--warning` | `oklch(0.8 0.14 85)` | `oklch(0.82 0.13 85)` | 7.2 → 7.8:1 |
| `--muted-foreground` | `oklch(0.66 0.012 285)` | `oklch(0.68 0.012 285)` | 12px labels → 6.4:1 |
| `--border` | `oklch(0.26 0.012 285)` | `oklch(0.24 0.012 285)` | Hairlines recede |
| `--primary` | `oklch(0.68 0.16 262)` | `oklch(0.70 0.16 262)` | Brighter accent |
| `--card` | `oklch(0.165 0.007 285)` | `oklch(0.155 0.008 285)` | Elevation via border+shadow, not bg |
| `--chart-*` | 5 tokens | **9 tokens** | see below |

**New token groups** (from tokens.json):
- `--shadow-{xs,sm,md,lg,focus}` — elevation system
- `--duration-{fast,base,slow}` + `--ease-{out,in-out,spring}` — motion
- `--spacing-{1..8}` — spacing scale (4/8/12/16/24/32/48/64px)
- `--text-{2xs,xs,sm,md,lg,xl,2xl}` — type scale
- `--row-height`, `--row-padding-x`, `--table-font-size` — density (set by `data-density` on `<html>`)
- `--z-{dropdown,sticky,modal,popover,toast,commandBar}` — z-index scale

**Density wiring (critical):**
```css
:root { --row-height: 40px; --row-padding-x: 12px; --table-font-size: 14px; --density: comfortable; }
html[data-density='compact'] {
  --row-height: 30px; --row-padding-x: 8px; --table-font-size: 12px; --density: compact;
}
/* auto-comfortable on small screens regardless of preference */
@media (max-width: 640px) {
  html[data-density='compact'] { --row-height: 40px; --row-padding-x: 12px; --table-font-size: 14px; --density: comfortable; }
}
```

**Chart palette (options.ts):** replace the hardcoded `CATEGORY_COLORS` hex array with a mapping to the 9 CSS vars:
```ts
export const CATEGORY_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)',
  'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)', 'var(--chart-9)',
]
```
`GAIN`/`LOSS` in options.ts → `'var(--gain)'` / `'var(--loss)'`.

---

## 2. New Lib Modules

### `src/lib/density.ts`
- `DensityProvider` React context + `useDensity()` hook.
- State: `'comfortable' | 'compact'`; default `'comfortable'`.
- Persists to `localStorage('portfolio-density')`; applies `document.documentElement.dataset.density`.
- On mount: read localStorage → apply. Listen to `storage` events (multi-tab).

### `src/lib/useKeyboardShortcuts.ts`
- `useKeyboardShortcuts(handlers: Record<string, () => void>)`.
- Global `keydown` listener, ignores when target is input/textarea/contentEditable.
- Bindings: `/` → focus search (per-screen), `r` → refresh, `?` → shortcuts dialog, `⌘K`/`Ctrl+K` → command bar, `d` → toggle density.
- `preventDefault` for handled keys.

### `src/lib/useIntersectionObserver.ts`
- `useInView<T extends Element>(options?): [ref, inView]`.
- Used by HoldingsTable to lazily render row sparklines (only when scrolled into view).

### `src/lib/sparkline.ts`
- `sparklineOption(values: number[], opts: { gain: boolean }): EChartsOption`
- Mini line: `type: 'line'`, `symbol: 'none'`, `lineStyle: { width: 1.5, color: gain? 'var(--gain)':'var(--loss)' }`, no axes, no tooltip (tooltip lives in the row), `animation: true`, grid zero-padded.
- Height 24px; width 56px per cell.
- Data: **platform series from `history.json` `byPlatform[platform]`** — per-holding history is NOT in the contract (decision doc §4). The sparkline communicates *platform trend*; the row's own values are in the cells. Tooltip on the row shows "Platform trend (last N snapshots)".

---

## 3. Component Specs

### 3.1 `Card` (ui/card.tsx) — variants
- Add `variant?: 'flat' | 'raised' | 'interactive'`.
  - `flat` (default): current look, `bg-card`, hairline border.
  - `raised`: `bg-card` + `--shadow-sm`.
  - `interactive`: `raised` + hover `translateY(-2px)` + `--shadow-md` (120ms `--ease-in-out`, transform-only — no CLS).
- Keep existing exports (CardHeader/Title/Description/Content/Footer) — add props without breaking usage.

### 3.2 `states.tsx` — screen-aware skeletons
- Replace generic `LoadingState` internals with variants:
  - `ScreenSkeleton kind="overview"` — 4 card skeletons (h-28) + 1 chart skeleton (h-72).
  - `ScreenSkeleton kind="table"` — header row + 10 row skeletons at `--row-height`.
- `ErrorState` gains `kind?: 'network' | 'contract' | 'pipeline'` → tailored copy; default copy unchanged.
- `EmptyState` gains optional `action?: { label: string; onClick: () => void }` — renders a `Button` below the description.

### 3.3 `FilterBar` (NEW, `src/components/filter/FilterBar.tsx`)
- Extracted from ReturnsScreen's pill groups; reused by IndiaView/USView.
- Props: `groups: Array<{ id: string; label: string; options: Array<{ value: string; label: string }>; value: string; onChange: (v: string) => void }>`.
- Renders one pill group per `group`, separated by a divider.
- Pills: `<button>` with `aria-pressed`, `focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background`, active = `bg-background text-foreground shadow-sm`, inactive = `text-muted-foreground hover:text-foreground`.
- `role="group"` + `aria-label` per group.

### 3.4 `OverviewCards` — multi-metric 2×2 mini-grids
Each of the 4 cards becomes:
```
┌──────────────────────────┐
│ NET WORTH           [ⓘ] │   label 11px muted + tooltip
│ ₹67.98L                 │   value text-xl semibold tabular
│ ┌─────────┬─────────┐   │
│ │ dayPnl  │ 7d %    │   │   2×2 mini-grid, 12px
│ │ ▴ ₹186  │ ▴ 1.2%  │   │   deltas colored gain/loss
│ ├─────────┼─────────┤   │
│ │ coverage│ XIRR    │   │   XIRR shows "—" + honest tooltip
│ │ 48/68   │ —       │   │
│ └─────────┴─────────┘   │
└──────────────────────────┘
```
- Card 1 Net Worth: value + (dayPnl, 7d change, coverage w/cost, XIRR) — *actually per D2 the 4 cards are NetWorth/DayP&L/Return/XIRR; simpler: each card keeps its headline + 3 sub-metrics*:
  - **Net Worth**: headline ₹, subs: dayPnl, 7d%, cost coverage
  - **Day P&L**: headline ₹, subs: day %, per-currency split (INR/SGD), "as of"
  - **Simple Return**: headline %, subs: withCost, withoutCost, XIRR cross-ref
  - **XIRR**: headline % or "—", subs: accounts, flows, "no trades yet" badge
- Sub-metrics change animation: on data refresh, counters animate 0→value over 400ms (`--ease-in-out`), `role="status"`.

### 3.5 `HoldingsTable` (MAJOR)
- **Density-aware**: row height/padding/font from `--row-height`/`--row-padding-x`/`--table-font-size`; `style={{ height: 'var(--row-height)' }}` on `<tr>` or class-based.
- **Keyboard sortable headers**: `tabIndex={0}`, `onKeyDown` Enter/Space toggles sort; `aria-sort={sorted}` on `<th scope="col">`.
- **Sticky header**: `<thead>` `sticky top-0 bg-background/80 backdrop-blur` (within the card's scroll container).
- **Column hover tint**: `th:hover bg-accent/30`.
- **Sparkline column**: `Sparkline` cell after `Value`, using `useInView` + `sparklineOption`; column header "Trend (7d)" with tooltip "Platform value trend across recent snapshots".
- **Arrow-key row navigation**: selected row via `aria-activedescendant` on the `<table>` (`role="grid"`? — keep `table` semantics but add `tabIndex={0}` on tbody container + arrow keys move `selectedRow`; visual = `bg-accent/60`); Enter on selected row → (future drill) no-op for now, keep focus ring.
- **Search input**: same, add `id` + `aria-label="Search holdings"`.
- **Row count + empty states**: unchanged behavior.

### 3.6 `TrendChart` — dataZoom + range pills
- Range pills: `[1M][3M][6M][1Y][All]` above the chart (right-aligned). Filter `history.dates` client-side (dates are ISO strings — slice by `new Date(d) >= today - N`).
- ECharts `dataZoom` (inside, `type: 'inside'` + `type: 'slider'`, `bottom: 0`, `throttle: 60`) — import from `echarts/core` (`DataZoomComponent`).
- Tooltip shows full `YYYY-MM-DD` date.
- Keep portfolio area + geography lines + masked behavior.

### 3.7 `AllocationDonuts` — a11y fallback
- Under each donut, render a visually-hidden `<table>`: caption = title, rows = slice name + pct.
- `aria-describedby` from donut container to the hidden table.
- Center label: add `title` attr with top slice name (already there via graphic).

### 3.8 `CommandBar` (NEW, `src/components/command/CommandBar.tsx`)
- Fixed bottom-center, `z-commandBar`, 560px max-width, `--shadow-lg`, `rounded-lg`.
- Opens with `⌘K`/`Ctrl+K` or `/`; closes with Esc/outside click.
- Input + fuzzy results list:
  - **Holdings** (from `useLatest().data.holdings`): ticker, name, platform — click → navigate to Holdings tab with search prefilled (`/holdings?q=SMH` via AppShell state).
  - **Tabs**: Overview/India/US/Returns/Alerts — click → switch tab.
  - **Actions**: Refresh now, Toggle privacy, Toggle density, Shortcuts (`?`).
- Arrow keys move selection (`aria-activedescendant`), Enter executes, `role="combobox"`/`role="option"` semantics.
- Fuzzy match: simple subsequence/includes matcher (no dep) — case-insensitive `includes` on ticker/name/platform, prefix on tabs/actions.
- Filter results as you type; empty state "No matches".

### 3.9 `ChatDrawer` — a11y + polish
- Message list: `role="log"` + `aria-live="polite"` on the ScrollArea inner container.
- Thinking indicator: 3 dots with `--ease-spring` bounce (CSS keyframe, 3 dots staggered 120ms).
- Tool chips + offline banner unchanged (already good).

### 3.10 `AppShell` — density toggle, shortcuts, command bar
- Add density toggle button (icon: `Rows3`/`Rows2` from lucide) in the header, `aria-pressed`, `title="Toggle density"`.
- Mount `CommandBar` at app root.
- `useKeyboardShortcuts` wiring: `/` focuses active tab's search; `r` → triggers refresh (via existing refresh hook in StatusBar — refactor refresh state up to AppShell or context); `?` → shortcuts dialog (simple modal listing bindings); `⌘K` → command bar.
- Shortcuts dialog: `role="dialog"`, `aria-modal`, Esc closes, focus trap (basic).

### 3.11 `StatusBar`
- Refresh button: `focus-visible` ring (exists) — ensure; add `aria-live="polite"` region for the refresh flash message.
- Stale badges: `animate-pulse` ×3 on appearance then steady (CSS `animation` with `3` iterations).

---

## 4. Screen Specs (unchanged structure, enhanced behavior)

| Screen | Changes |
|---|---|
| **Overview** | New OverviewCards (3.4), TrendChart dataZoom+pills (3.6), donut a11y (3.7), entrance stagger on mount (see motion spec) |
| **India / US** | FilterBar extraction (3.3) if platform/asset pills exist there; HoldingsTable upgrades (3.5) |
| **Returns** | FilterBar extraction (3.3); holdings table NOT used here (chart view); add bar end-labels (`label: { show: true, position: 'right', color: CHART_TEXT, fontSize: 10 }`); XIRR cards honest badge unchanged |
| **Alerts** | Add `aria-live="polite"` on the fired list; severity counts unchanged; rows get focus outline (they're `li`, non-interactive — no change needed, but ensure `li` colors AA) |
| **Chat** | 3.9 changes only |

---

## 5. Responsive Behavior

| Breakpoint | Behavior |
|---|---|
| ≤640px | Density forced comfortable (CSS); command bar → full-width bottom sheet (max-width 100%); FilterBar pills wrap; sparkline column hides (`hidden md:table-cell`); tabs icons-only (existing) |
| 641–1024px | Sparkline column visible; 2-col OverviewCards; donuts 2-col (existing); command bar centered |
| >1024px | 4-col cards/donuts; full table with sparklines; command bar 560px |

---

## 6. Implementation Order (suggested by the orchestrator)

1. **index.css tokens** + density wiring + chart palette mapping (foundation — everything builds on it).
2. **lib modules**: density.ts, useKeyboardShortcuts.ts, useIntersectionObserver.ts, sparkline.ts.
3. **ui/card.tsx** variants + **states.tsx** skeletons.
4. **OverviewCards** multi-metric + **TrendChart** dataZoom/pills + donut a11y.
5. **FilterBar** extraction (Returns + India/US).
6. **HoldingsTable** upgrades (density, keyboard, sticky, sparklines, arrow-nav).
7. **CommandBar** + **AppShell** wiring + shortcuts dialog.
8. **ChatDrawer** a11y/polish.
9. Motion pass (per motion spec) — apply entrance/refresh/cross-filter keyframes.
10. Verify: `npm run build` + `npm run typecheck` + `npm run lint` + `npm run check:contract`; visual QA against `dashboard/public/data/*.json` in dev server.

---

## 7. Verification Checklist (for dashboard-builder)

- [ ] `npm run build` green (tsc strict + vite)
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean (oxlint)
- [ ] `npm run check:contract` parses the real exports (68 holdings, allocSum 100.00%)
- [ ] Density toggle switches comfortable↔compact and persists across reload
- [ ] Sparklines render only for in-view rows (IntersectionObserver proven via scroll)
- [ ] `aria-sort` present on sorted headers; Enter/Space sorts
- [ ] Arrow keys navigate rows; `aria-activedescendant` correct
- [ ] Command bar: `⌘K` opens, fuzzy finds "smh" → SMH row, Enter navigates + prefills search
- [ ] `R` triggers refresh; `?` opens shortcuts; `/` focuses search
- [ ] `prefers-reduced-motion: reduce` → zero animation (test via devtools)
- [ ] `--loss` cells contrast ≥ 4.5:1 (spot-check with a contrast tool)
- [ ] Contract files untouched (`git diff -- dashboard/src/types/contract.ts` empty)
- [ ] Bundle diff ≤ +50KB (`npm run build` + size comparison)
- [ ] Visual QA: Overview/India/US/Returns/Alerts/Chat all render with live data; empty/masked/stale states correct