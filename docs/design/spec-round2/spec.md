# Dashboard Revamp — Implementation Spec: "Journey OS" (Hybrid 2+3)

**Handoff document for `dashboard-builder`.** Read first:
`docs/design/round2/2026-08-18-round2-selected-direction.md` (decision rationale +
scope) and `docs/design/spec-round2/tokens.json` (machine-readable tokens).
Supersedes the round-1 spec (`docs/design/spec/` — history only; its component
polish is absorbed here).

---

## 0. Hard Constraints (non-negotiable)

1. `dashboard/src/types/contract.ts` — **IMMUTABLE**. No field renames, no new fields.
   `dashboard/src/lib/data.ts` — do not change the shape of fetched data.
2. Determinism boundary — only `ChatDrawer` touches the agent; every other surface
   renders from static JSON via the Zod contract.
3. Stack locked: Vite 8 + React 19 + TS strict, Tailwind v4 (CSS-first, no config
   file), shadcn/ui v4 New York, ECharts 6 (modular `echarts/core` imports only),
   TanStack Query, Zod v4, lucide-react.
4. **Light AND dark themes — both first-class.** `data-theme="light"|"dark"` on
   `<html>` + `.dark` class retained for shadcn compat. OS preference on first
   visit, persisted toggle, keyboard `T`.
5. Bundle: +50KB max over current. **No Framer Motion**, no new chart lib, no new
   runtime deps beyond shadcn primitives.
6. WCAG AA in BOTH themes. `prefers-reduced-motion` must disable all animation.
7. All tokens in `@theme inline` CSS custom properties — never hardcoded values in
   components.
8. No real-money values outside the already-committed fixture exports; the privacy
   mask (`MASK_TEXT`) behavior is preserved everywhere.

---

## 1. Design Tokens (index.css)

Apply `docs/design/spec-round2/tokens.json`. Structure:

```css
:root { /* LIGHT theme tokens */ }
.dark { /* DARK theme tokens */ }
@theme inline { /* map --color-* utilities to vars, existing pattern */ }
```

### Light theme (NEW — the current file is dark-only)
| Token | Value (oklch) | Notes |
|---|---|---|
| `--background` | `0.985 0.002 285` | cool near-white |
| `--foreground` | `0.21 0.01 285` | ink |
| `--card` | `1 0 0` | white |
| `--panel` (new) | `0.955 0.005 285` | universe/context pane tint |
| `--popover` | `1 0 0` | |
| `--primary` | `0.55 0.18 262` | deeper blue (AA on white) |
| `--primary-foreground` | `0.985 0.002 285` | |
| `--secondary` | `0.94 0.008 285` | |
| `--secondary-foreground` | `0.25 0.01 285` | |
| `--muted` | `0.955 0.005 285` | |
| `--muted-foreground` | `0.47 0.012 285` | ≥4.5:1 on white |
| `--accent` | `0.93 0.01 285` | |
| `--accent-foreground` | `0.25 0.01 285` | |
| `--destructive` | `0.55 0.19 25` | |
| `--destructive-foreground` | `0.985 0.002 285` | |
| `--border` | `0.9 0.008 285` | |
| `--input` | `0.88 0.01 285` | |
| `--ring` | `0.55 0.18 262` | |
| `--gain` | `0.52 0.14 155` | AA on white |
| `--loss` | `0.55 0.19 25` | AA on white |
| `--warning` | `0.62 0.15 85` | AA on white |
| `--chart-1..9` | see tokens.json | saturated-dark categoricals, AA on white |

### Dark theme (audit-fixed from current)
| Token | Current | New | Fix |
|---|---|---|---|
| `--loss` | `0.63 0.2 25` | `0.70 0.17 25` | 4.2:1 → 5.3:1 |
| `--gain` | `0.72 0.15 155` | `0.74 0.14 155` | 5.1 → 5.9:1 |
| `--warning` | `0.8 0.14 85` | `0.82 0.13 85` | 7.2 → 7.8:1 |
| `--muted-foreground` | `0.66 0.012 285` | `0.68 0.012 285` | 12px labels AA |
| `--primary` | `0.68 0.16 262` | `0.70 0.16 262` | brighter accent |
| `--card` | `0.165 0.007 285` | `0.155 0.008 285` | elevation via border+shadow |
| `--panel` (new) | — | `0.15 0.007 285` | pane distinction |
| `--chart-1..9` | 5 tokens | **9 tokens** | see tokens.json |

### New token groups (both themes)
- `--shadow-{xs,sm,md,lg,focus}` — elevation system (cards lift via border + shadow, not bg)
- `--duration-{fast,base,slow}` + `--ease-{out,in-out}` — motion
- `--spacing-{1..8}` — 4/8/12/16/24/32/48/64px scale
- `--text-{2xs,xs,sm,md,lg,xl,2xl}` — type scale
- `--row-height`, `--row-padding-x`, `--table-font-size` — density (set by `data-density` on `<html>`)
- `--z-{dropdown,sticky,modal,popover,toast,commandBar}` — z-index scale
- `color-scheme: light|dark` on `html` per theme (native scrollbars/forms match)

---

## 2. New Lib Modules

### `src/lib/theme.ts`
ThemeProvider: reads localStorage → `data-theme` attr on `<html>` (+`.dark`),
defaults to `prefers-color-scheme`; `cycleTheme()` for the T shortcut
(light→dark→system→light). `useTheme()` hook.

### `src/lib/density.ts` (round-1 carryover)
`data-density="comfortable|compact"` on `<html>`, persisted; auto-comfortable
below 640px (media query); `useDensity()` hook. Table row heights + paddings from
`--row-*` tokens.

### `src/lib/useKeyboardShortcuts.ts`
Central registry: `⌘K`/`/` open CommandBar; `⌘1..⌘6` switch workspaces; `R`
refresh; `T` theme cycle; `?` shortcuts dialog; `Esc` closes overlay/returns from
dossier. Ignored when focus is in an input (except ⌘K). Listens on `window`.

### `src/lib/useIntersectionObserver.ts`
Lazy-mount heavy charts/sparklines when scrolled into view (journey chart + table
sparklines). One shared observer via a module-level singleton.

### `src/lib/sparkline.ts`
Mini ECharts option builder for in-row 7-day trend sparklines. Data source:
`history.byPlatform[platform]` (the honest fallback — per-holding history is NOT
in the contract). Tooltip shows the platform value series; no axes, no legend.

### `src/lib/goals.ts`
localStorage-backed goals: `[{id, label, targetAmount, color}]`. Pure CRUD +
`progress(goal, valueBase)` → `clamp(valueBase/targetAmount)`. Seed the milestone
journal from `history.json` deltas on first run.

### `src/lib/workspaces.ts`
Workspace registry: `journey | india | us | returns | alerts | properties` +
`dossier:<ticker>` transient state. `useWorkspace()` hook; command-bar items built
from this registry.

---

## 3. Shell Specs

### 3.1 `AppShell.tsx` (MAJOR)
Three-pane flex row: `UniversePane` (left, 300–340px, collapsible) · `WorkspaceCenter`
(flex-1) · `ContextRail` (right, 280px, collapsible). Header on top, HealthTicker
footer below. Pane collapse toggles: chevron buttons with `aria-expanded` +
`aria-controls`. Below 1280px the right rail defaults collapsed; below 768px panes
stack into drill-down (list → detail → context) with a bottom action bar.

### 3.2 `Header.tsx` (NEW)
Row: brand tile + wordmark (hidden ≤sm) · ⌘K trigger button (full-width-ish,
focus ring; shows "⌘K" kbd hint; on mobile a magnifier icon) · right cluster:
theme toggle (dropdown-menu ☀️/🌙/Auto), refresh button (spinning state →
sonner toast), chat toggle (same behavior as today), privacy eye toggle (same as
today). Height 48–56px, `border-b`.

### 3.3 `HealthTicker.tsx` (NEW — footer, supersedes StatusBar)
One line: `As of 18 Aug 09:52 IST` · per-platform freshness dot + name
(green/amber, tooltip with `asOf` long form + threshold) · `FX USD/INR 84.2` ·
`NAV 21 MFs` · `runs ok`. `role="status"`, `aria-live="polite"` on the refresh
toast region. Stale platform = amber dot + "11d stale" text.

### 3.4 `UniversePane.tsx` (NEW)
- Header: "Holdings" + count + FilterBar (geography/asset pills, `aria-pressed`).
- Search input (filters by ticker/name/platform).
- `HoldingsTable` (3.5) with row selection → `onSelect(ticker)` → WorkspaceCenter
  shows the dossier. Selected row highlighted (`bg-accent` + `aria-selected`).
- Collapsible; below 768px it becomes a full-screen list with back button.

### 3.5 `HoldingsTable.tsx` (MAJOR, round-1 carryover)
- Keyboard-sortable headers: `role="columnheader"`, `aria-sort="ascending|descending"`,
  Enter/Space toggles sort; visible sort arrow icon.
- Sticky header within the pane (`position: sticky; top: 0`).
- Arrow-key row navigation: roving `tabindex` + `aria-activedescendant` on the
  table; Enter selects the row (opens dossier); `aria-selected` on active row.
- In-row 7-day sparkline column (IntersectionObserver lazy-mount, `sparkline.ts`).
- Density-aware: row height from `--row-height` per `data-density`.
- Columns: ticker (+ platform badge), name, qty, avg, current, value, day P&L %,
  return % (— for costless), sparkline. All values honor the privacy mask.

### 3.6 `WorkspaceCenter.tsx` (NEW)
Hosts the active workspace. Top: slim segmented control (Journey · India · US ·
Returns · Alerts · Properties — shadcn `tabs`), `aria-current` on active. When a
dossier is open: breadcrumb `← India / KPITTECH` + the `HoldingDossier`. Workspace
switch via ⌘K/⌘1..⌘6/segmented control; state preserved per workspace.

### 3.7 `ContextRail.tsx` + `AllocationLens.tsx` (NEW)
- `AllocationLens`: the 4 donuts (geography / platform / sector / asset class)
  become **filter controls**: click a slice = filter ON (selected slice stays
  highlighted, others dim), click again or "clear" = off. Cross-filter applies to
  UniversePane + India/US/Returns workspaces; **Journey is never filtered**.
  Each donut has an accessible fallback: a hidden `<table>` of slice values
  (`sr-only`) + `aria-pressed` on slices.
- `AttentionRail` (below donuts): stacked cards — fired alerts (severity badge),
  stale platforms ("moomoo 11d stale — 2d threshold"), session expiries
  ("zerodha session expires at 6 AM IST — log in"), biggest single-day movers.
  Red = act now, amber = watch. Empty → calm "All caught up" state.

### 3.8 `CommandBar.tsx` (NEW)
shadcn `command` dialog. Items: workspaces (⌘1..⌘6), holdings (ticker/name/
platform → opens dossier), actions (refresh, theme, privacy, density, shortcuts,
export note). Read-only navigation + local actions — **never pipeline writes**
(guardrail). `/` and `⌘K` open it; `Esc` closes; focus returns to trigger.

### 3.9 `ChatDrawer.tsx` (polish)
Stays a right drawer. `role="log"` + `aria-live="polite"` on the message list;
thinking dots are a 3-dot CSS pulse (reduced-motion: static "Thinking…").

---

## 4. Workspace Specs

### 4.1 `JourneyWorkspace.tsx` (NEW — default home)
```
₹1.03Cr  ▲ +₹4.2k today        [1M | 3M | 6M | 1Y | All]
┌──────────────────────────────────────────────────────────────┐
│ JourneyChart — ECharts area (history.json), gradient fill,   │
│   markLine goals, markPoint milestones, range pills, dataZoom │
└──────────────────────────────────────────────────────────────┘
┌──────────────┬──────────────────┬───────────────────────────┐
│ TodayPanel   │ AccountRoads     │ GoalMilestones+Journal    │
│ (day P&L in  │ (zerodha/moomoo/ │ (progress chips +         │
│  words, top  │  real_estate     │  milestone journal list)  │
│  mover)      │  mini-lines)     │                           │
└──────────────┴──────────────────┴───────────────────────────┘
```
- **`JourneyChart`:** area chart from `history.json` (dates + portfolioValueBase).
  Gradient fill via `graphic.LinearGradient`; `markLine` for each goal's target ₹;
  `markPoint` for milestone events (property added, ₹1Cr crossed). Range pills
  (1M/3M/6M/1Y/All) + `dataZoom` (inside slider). Theme-aware colors from
  `--primary` + chart tokens; `options.ts` builder.
- **`TodayPanel`:** day P&L in words ("down ₹33.9k — moomoo −₹461, zerodha +₹658"),
  top mover (ticker + %), today's alerts count. Honors privacy mask.
- **`AccountRoads`:** three mini-lines (zerodha INR from byPlatform, moomoo SGD,
  real_estate) — small ECharts lines, lazy-mounted, tooltip per currency.
- **`GoalMilestones`:** goal rows: label, target, `progress` bar, "62% there".
  Add/edit via a dialog (shadcn `dialog` + `input`). Crossing a goal fires a
  sonner toast once (localStorage-acked) + a card slides in.
- **`MilestoneJournal`:** auto-seeded list: "18 Aug 2026 — crossed ₹1Cr",
  "07 Aug — real estate leg added (+valuation)". Seed logic: scan `history.json`
  for the largest single-day jumps + cross-the-1Cr boundary; store in localStorage.
- **`YearStrip`:** "2026 so far: ₹X → ₹Y (+Z%)" from history (first vs last point).

### 4.2 `HoldingDossier.tsx` (NEW)
Center-pane detail when a universe row is selected:
- Position card: name, ticker, platform badge, qty, avg, current, cost basis,
  current value, day P&L, total P&L (— for costless rows — honest nulls).
- 7-day platform-trend sparkline (honest label: "platform trend").
- Internal tabs: **P&L** (returns math from `lib/returns.ts`), **Trades**
  (from latest.json if present; else "no captured trades yet" — honest), **Alerts**
  (linked fired alerts for this ticker, else empty state).
- Breadcrumb back (`←` or `⌘0`) returns to the previous workspace.

### 4.3 `IndiaView` / `USView` / `ReturnsScreen` / `AlertsScreen` / `PropertiesScreen`
Re-homed into the center pane unchanged in structure, upgraded by:
- FilterBar (geography/asset pills) on India/US/Returns.
- HoldingsTable upgrades (3.5) where tables appear.
- Returns: per-holding return bars (cost-bearing only), trend, XIRR cards with
  honest "no captured trades yet" badges — unchanged logic.
- Alerts: severity-colored fired-rules log; empty state — unchanged logic.
- Properties: existing PropertiesScreen content (import UI + list) — unchanged logic.

### 4.4 `states.tsx`
Screen-aware skeletons: Journey → hero skeleton (one large block + 3 cards);
tables → 10-row skeleton. ErrorState kinds (network / parse / empty) + EmptyState
with a primary action where one exists. All loading states honor reduced-motion.

---

## 5. Responsive Behavior

| Breakpoint | Behavior |
|---|---|
| >1280px | 3 panes all visible |
| 768–1280px | Right rail collapsed by default (toggle in header); 2 panes |
| <768px | Drill-down: Universe list → dossier/workspace full-screen → context as a sheet; bottom action bar (refresh, chat, theme, privacy) |

Journey chart range pills scroll horizontally on mobile; tables stay readable via
density auto-comfortable + horizontal scroll (existing pattern).

---

## 6. Implementation Order (suggested)

1. **Tokens + theme + density** (index.css, theme.ts, density.ts) — both themes
   visible immediately, `data-theme`/`data-density` wiring.
2. **Shell skeleton** (AppShell → Header, HealthTicker, UniversePane,
   WorkspaceCenter, ContextRail with empty states) — app runs, panes visible.
3. **Journey workspace** (JourneyChart + TodayPanel + AccountRoads + YearStrip +
   Goals + Journal) — default home lands.
4. **Universe + table upgrades** (HoldingsTable: keyboard/sort/sticky/sparklines,
   FilterBar) + **HoldingDossier**.
5. **AllocationLens cross-filter + AttentionRail.**
6. **CommandBar + shortcuts + toasts.**
7. **Motion pass** (entrance stagger, delta counters, theme cross-fade, journey
   draw) + reduced-motion audit.
8. **Verify** (below) + retire OverviewScreen/StatusBar, re-home remaining screens.

## 7. Verification Checklist

- `npm run build` green; bundle delta ≤ +50KB (check raw JS output sizes).
- `npm run typecheck` + `npm run lint` clean.
- `npm run check:contract` parses the real exports (69 holdings, allocSum 100%).
- Both themes: every screen renders with real fixture data; AA contrast on
  interactive text (spot-check --loss/gain/muted-foreground in devtools).
- Journey: timeline renders from history.json; range pills work; goals add/cross
  toast; journal seeded; account roads render.
- Universe: 69 rows; sort/keyboard/arrow-nav/select→dossier; sparklines lazy-mount.
- Cross-filter: donut click filters universe + India/US; Journey unfiltered.
- CommandBar: ⌘K searches holdings/workspaces/actions; zero non-allowlisted side
  effects (read-only navigation only).
- Refresh: `POST /api/refresh` → toast with summary; health ticker updates.
- Chat: works end-to-end (agent running) AND shows honest offline state (agent
  down) — dashboard never depends on it.
- `prefers-reduced-motion: reduce` → no animation anywhere; everything reachable.
- Privacy mask still hides all money/qty across every surface.
- Mobile (<768px): drill-down works; bottom bar reachable.