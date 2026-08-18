# Design Audit — Portfolio Dashboard (M8)

**Date:** 2026-08-18  
**Auditor:** ui-designer (senior product designer)  
**Scope:** Complete visual, interaction, and technical audit of the M8 dashboard  
**Stack:** Vite 8 + React 19 + TS strict, Tailwind v4 + shadcn/ui v4 (New York, dark-only), ECharts 6 (modular), TanStack Query/Table v8, Zod v4

---

## 1. Token Inventory

### Current CSS Custom Properties (`dashboard/src/index.css:15-57`)

| Token | Value | Purpose | Notes |
|-------|-------|---------|-------|
| `--radius` | `0.625rem` | Base radius (10px) | shadcn default |
| `--background` | `oklch(0.13 0.006 285)` | Page bg | Near-black blue-tint |
| `--foreground` | `oklch(0.97 0.004 285)` | Primary text | Near-white |
| `--card` | `oklch(0.165 0.007 285)` | Card bg | Slightly elevated |
| `--card-foreground` | `oklch(0.97 0.004 285)` | Card text | |
| `--popover` | `oklch(0.165 0.007 285)` | Popover bg | Same as card |
| `--popover-foreground` | `oklch(0.97 0.004 285)` | Popover text | |
| `--primary` | `oklch(0.68 0.16 262)` | Brand/accent | Indigo-violet |
| `--primary-foreground` | `oklch(0.98 0.004 285)` | On-primary text | |
| `--secondary` | `oklch(0.235 0.01 285)` | Secondary bg | Muted surface |
| `--secondary-foreground` | `oklch(0.93 0.005 285)` | On-secondary text | |
| `--muted` | `oklch(0.215 0.008 285)` | Muted bg | |
| `--muted-foreground` | `oklch(0.66 0.012 285)` | Muted text | Labels, hints |
| `--accent` | `oklch(0.25 0.012 285)` | Accent bg | Hover states |
| `--accent-foreground` | `oklch(0.95 0.004 285)` | On-accent text | |
| `--destructive` | `oklch(0.6 0.2 25)` | Error/danger | Red |
| `--destructive-foreground` | `oklch(0.98 0.004 285)` | On-destructive | |
| `--border` | `oklch(0.26 0.012 285)` | Borders | |
| `--input` | `oklch(0.26 0.012 285)` | Input borders | |
| `--ring` | `oklch(0.68 0.16 262)` | Focus rings | Matches primary |
| `--gain` | `oklch(0.72 0.15 155)` | Positive P&L | Green |
| `--loss` | `oklch(0.63 0.2 25)` | Negative P&L | Red |
| `--warning` | `oklch(0.8 0.14 85)` | Warnings | Amber |
| `--chart-1` | `oklch(0.68 0.16 262)` | Chart palette | Indigo |
| `--chart-2` | `oklch(0.72 0.15 155)` | Chart palette | Green |
| `--chart-3` | `oklch(0.8 0.14 85)` | Chart palette | Amber |
| `--chart-4` | `oklch(0.66 0.18 20)` | Chart palette | Red-orange |
| `--chart-5` | `oklch(0.75 0.12 300)` | Chart palette | Violet |

### Missing Token Categories
- **Spacing scale** — uses Tailwind defaults (4px base), no custom spacing tokens
- **Shadow scale** — only `shadow-sm` on cards, no elevation system
- **Motion tokens** — no duration/easing custom properties
- **Typography scale** — uses Tailwind defaults, no custom font-size/line-height tokens
- **Z-index scale** — ad-hoc (z-50 for drawer)
- **Breakpoint tokens** — Tailwind defaults only

### ECharts Palette Mismatch (`dashboard/src/components/charts/options.ts:16-27`)
The hardcoded `CATEGORY_COLORS` array (10 colors) diverges from CSS `--chart-*` tokens (5 colors). Donuts use the hardcoded array, creating inconsistency.

---

## 2. Component Inventory

### Layout Components

| Component | States Covered | Gaps |
|-----------|----------------|------|
| `AppShell` | Loading (via children), chat open/closed | No skeleton for shell itself |
| `StatusBar` | Loading (backend health), stale platforms, alerts, refresh states (idle/running/done/error), chat toggle | No focus indicator on refresh button when keyboard-navigated |
| `LoadingState` | Full-page skeleton (4 cards + chart) | Generic, doesn't match specific screen layout |
| `ErrorState` | Error with retry | No error classification (network vs contract vs auth) |
| `EmptyState` | Title, description, icon | No action button variant |
| `Spinner` | Inline loading | Single size only |

### Screen Components

| Screen | Layout | Data Requirements | Responsive Behavior |
|--------|--------|-------------------|---------------------|
| **Overview** | 4 metric cards (1/2/4 cols) → 4 donuts (1/2/4 cols) → 1 trend chart | `latest.json`, `history.json`, `xirr.json` | Cards stack on mobile, donuts stack, chart full-width |
| **India View** | Filter bar (platform pills + asset class pills) → HoldingsTable | `latest.json` (INR holdings) | Filters wrap, table horizontal scroll |
| **US View** | Filter bar (asset class pills only) → HoldingsTable | `latest.json` (SGD holdings) | Same as India |
| **Returns** | Geo filter pills → Asset class pills → Summary card → Return bars chart → Trend chart → XIRR cards (1/2 cols) | `latest.json`, `history.json`, `xirr.json` | Pills wrap, bars chart height scales with data count |
| **Alerts** | Header with severity counts → List of alert rows | `alerts.json` | Single column, rows stack |
| **Chat Drawer** | Fixed right panel (400px desktop, full-width mobile) | `/api/ask` (bridge → opencode) | Desktop: sidebar; Mobile: bottom sheet |

### UI Primitives (shadcn/ui v4)

| Component | Variants | States | Notes |
|-----------|----------|--------|-------|
| `Button` | default, destructive, outline, secondary, ghost, link | hover, focus-visible, disabled, loading (via Spinner) | `asChild` for composition |
| `Badge` | default, secondary, destructive, outline, success, warning, danger | hover (outline only), focus | Used for status, filters, platform labels |
| `Card` | Header, Title, Description, Content, Footer | — | `shadow-sm` only elevation |
| `Input` | — | focus-visible, disabled, placeholder | Search input in HoldingsTable |
| `Tabs` | — | active, disabled, focus-visible | Top nav in AppShell |
| `Tooltip` | — | hover/focus trigger, animate-in | Used extensively in StatusBar |
| `ScrollArea` | vertical/horizontal | custom scrollbar | Chat drawer messages |
| `Separator` | horizontal/vertical | — | Chat drawer divider |
| `Skeleton` | — | animate-pulse | Loading states |
| `Textarea` | — | autosize (max 160px), disabled | Chat input |

### Data Display Components

| Component | Purpose | Interactions |
|-----------|---------|--------------|
| `OverviewCards` | 4 KPI cards with hints (tooltips) | Hover tooltip on ⓘ |
| `AllocationDonuts` | 4 donut charts (geo/platform/sector/asset-class) | Hover tooltip, legend scroll |
| `TrendChart` | Area chart (portfolio + geo lines) | Hover crosshair tooltip |
| `HoldingsTable` | Sortable, searchable table (TanStack Table v8) | Sort (click header), search, hover row highlight |
| `ReturnBars` | Horizontal bar chart (per-holding returns) | Hover tooltip |
| `XirrCards` | Per-account XIRR display | — |
| `AlertRow` | Single alert with severity icon/badge | — |

---

## 3. Screen Map

### Tab Structure & Navigation
```
AppShell (fixed header 48px)
├── Brand + Tab Navigation (5 tabs: Overview, India, US, Returns, Alerts)
├── StatusBar (48px, below tabs)
├── Main Content (flex-1, scrollable)
│   ├── OverviewScreen
│   ├── IndiaView
│   ├── USView
│   ├── ReturnsScreen
│   └── AlertsScreen
└── ChatDrawer (fixed right, 400px desktop / 100% mobile)
```

### Data Flow per Screen

| Screen | Primary Queries | Derived/Computed |
|--------|-----------------|------------------|
| Overview | `useLatest()`, `useHistory()`, `useXirr()` | Simple return (client-side), XIRR headline pick |
| India | `useLatest()` → filter `geography === 'IN'` | Platform + asset class filters, totals |
| US | `useLatest()` → filter `geography === 'US'` | Asset class filter, SGD totals |
| Returns | `useLatest()`, `useHistory()`, `useXirr()` | Geo/asset filters, simple return, cost-bearing holdings |
| Alerts | `useAlerts()` | Severity counts |
| Chat | `useLatest()` (for context) | `askQuestion()` POST to bridge |

### Responsive Breakpoints (Tailwind defaults)
- `< 640px` (mobile): Tabs show icons only, cards stack 1-col, drawer full-screen
- `640px–1024px` (tablet): Tabs show labels, cards 2-col, donuts 2-col
- `>1024px` (desktop): Full layout, 4-col cards/donuts, drawer 400px sidebar

---

## 4. Data Density Analysis

### Information per Pixel

| Screen | Data Points Visible | Visual Weight | Density Rating |
|--------|---------------------|---------------|----------------|
| Overview | 4 KPIs + 4× donut slices (up to 24 sector) + ~30 trend points | High (charts dominate) | ★★★★☆ |
| India View | Up to 35 holdings × 10 columns | Very High (table) | ★★★★★ |
| US View | Up to 6 holdings × 9 columns | Medium | ★★★☆☆ |
| Returns | ~20 cost-bearing bars + 30 trend points + up to 4 XIRR cards | High | ★★★★☆ |
| Alerts | Up to ~10 alert rows | Low | ★★☆☆☆ |

### Table Density (HoldingsTable)
- **Columns:** Ticker, Name, Platform (India only), Qty, Avg Price, LTP, Value, Day %, Return %
- **Row height:** ~40px (py-2 + borders)
- **Information density:** 10 data points per row
- **Issues:** No column resizing, no density toggle (comfortable/condensed), horizontal scroll on mobile loses context

### Chart Information Richness
- **Donuts:** Show top slice % + name in center; legend scrollable but truncated at 14 chars; no value on hover for non-top slices without tooltip
- **Trend Chart:** Portfolio area + geo lines; x-axis shows MM-DD only (loses year context); no range selector/data zoom
- **Return Bars:** Horizontal bars sorted by return; shows ticker labels on y-axis; no value labels on bars; height scales but maxes at 480px

---

## 5. Motion Inventory

### Current Animations

| Trigger | Animation | Duration | Easing | Implementation |
|---------|-----------|----------|--------|----------------|
| Button hover | `background-color`, `color` | ~150ms | default (ease) | `transition-colors` |
| Tab active | `background`, `color`, `box-shadow` | ~150ms | default | `transition-all` |
| Badge hover (outline) | `border-color`, `color` | ~150ms | default | `transition-colors` |
| Tooltip appear | `fade-in` + `zoom-in-95` | ~150ms | default | Radix `animate-in` |
| Table row hover | `background-color` | ~150ms | default | `transition-colors` |
| Chat scroll to bottom | `scrollIntoView({behavior: 'smooth'})` | ~300ms | browser default | Native API |
| Flash message (refresh) | Appear → 4s → fade | 4000ms + fade | default | React state + setTimeout |
| ECharts donut emphasis | `scaleSize: 4` (4px scale) | ~300ms | cubicBezier | ECharts built-in |
| ECharts trend line | `smooth: 0.3` | render-time | — | ECharts built-in |
| Skeleton | `animate-pulse` (opacity) | 2s infinite | ease-in-out | Tailwind `@keyframes pulse` |

### Missing Motion Categories
- **Page/tab transitions** — instant swap, no cross-fade or slide
- **Data refresh transitions** — tables/charts snap to new data
- **Entrance animations** — no stagger on card/chart reveal
- **Drill-down transitions** — no zoom/expand from summary to detail
- **Cross-filter animations** — no visual feedback when filters change results
- **Loading → loaded transitions** — skeleton → content snap

---

## 6. A11y Gaps

### Contrast Ratios (OKLCH Verification)
| Pair | FG | BG | Contrast | WCAG AA? |
|------|-----|-----|----------|----------|
| Primary text | `--foreground` (0.97) | `--background` (0.13) | ~15.2:1 | ✅ |
| Muted text | `--muted-foreground` (0.66) | `--background` (0.13) | ~5.8:1 | ✅ |
| Card text | `--card-foreground` (0.97) | `--card` (0.165) | ~12.1:1 | ✅ |
| Gain text | `--gain` (0.72) | `--background` (0.13) | ~5.1:1 | ✅ |
| Loss text | `--loss` (0.63) | `--background` (0.13) | ~4.2:1 | ❌ (AA large text only) |
| Warning text | `--warning` (0.80) | `--background` (0.13) | ~7.2:1 | ✅ |
| Border | `--border` (0.26) | `--background` (0.13) | ~2.3:1 | ❌ (non-text) |

**Critical Issue:** `--loss` (red) on `--background` fails WCAG AA for normal text (4.2:1 < 4.5:1). Used for negative P&L numbers throughout.

### Focus States
- ✅ Buttons: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- ✅ Tabs: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- ✅ Inputs: `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`
- ✅ Badge (outline): `focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2`
- ❌ Table headers (sortable): No visible focus ring (only `cursor-pointer hover:text-foreground`)
- ❌ Filter pills: No focus styles
- ❌ Chat suggestion buttons: No focus styles

### ARIA & Semantic Structure
- ✅ `role="status"` on LoadingState
- ✅ `aria-label` on icon-only buttons (chat toggle, privacy toggle, refresh)
- ✅ `aria-pressed` on toggle buttons
- ✅ `Tooltip` for truncated/staleness info
- ❌ Heading hierarchy: Most screens use `CardTitle` (text-xs) as de facto headings; no `<h1>`–`<h6>` structure
- ❌ Chat messages: No `role="log"` or `aria-live` for new messages
- ❌ Table: No `scope="col"` on headers, no `aria-sort` on sortable columns
- ❌ Donut charts: No accessible alternative (screen readers see empty canvas)

### Keyboard Navigation
- ✅ Tab order follows visual order
- ✅ Escape closes chat drawer (via button)
- ❌ No keyboard shortcut for "Refresh now"
- ❌ Table sorting not keyboard-accessible (click only)
- ❌ Filter pills not keyboard-focusable (native `<button>` but no focus style)

---

## 7. Performance Baseline

### Bundle Analysis (Production Build)

| Chunk | Size (bytes) | Size (KB) | Purpose |
|-------|--------------|-----------|---------|
| `echarts-CbMAsiSg.js` | 603,492 | 589 KB | ECharts (tree-shaken modular) |
| `react-CCqFQxwj.js` | 181,740 | 177 KB | React 19 + React DOM |
| `index-D7x3Jrd5.js` | 161,386 | 158 KB | App code + components |
| `data-DFo9vH9L.js` | 161,249 | 157 KB | TanStack Query/Table + Zod |
| `rolldown-runtime-hePW80VL.js` | 716 | <1 KB | Vite/Rolldown runtime |
| **Total JS** | **1,108,583** | **1,083 KB** | ~350 KB gzipped (est.) |
| CSS | ~8 KB | ~8 KB | Tailwind + custom |

### Core Web Vitals Estimates (Unmeasured)
- **LCP:** ~1.8–2.5s (ECharts chunk blocks initial paint; app chunk loads first but charts render after)
- **CLS:** Low (static layout, no late-injected content except chat drawer)
- **TBT:** Moderate (ECharts initialization on main thread; TanStack Table row rendering)
- **INP:** Good for static interactions; chat input may have delay during agent response

### Optimization Opportunities
1. **ECharts lazy load** — defer chart chunks until tab visible (Overview/Returns)
2. **Virtualize HoldingsTable** — 68 rows is fine now, but will grow
3. **Code-split chat drawer** — heavy dependency (only needed when opened)
4. **Preload latest.json** — critical for LCP content

---

## Summary of Key Findings

### Strengths
- Clean, consistent dark theme with OKLCH tokens
- Solid component architecture (React.memo, TanStack Table, Zod contracts)
- Good privacy masking implementation
- Deterministic rendering boundary respected
- Type-safe data layer with contract validation

### Critical Issues
1. **Color contrast failure** — `--loss` red fails WCAG AA on dark background
2. **No motion system** — jarring instant transitions, no data refresh feedback
3. **Flat heading hierarchy** — poor screen reader navigation
4. **ECharts bundle dominates** — 55% of JS weight
5. **Table density fixed** — no compact/comfortable toggle
6. **Filter pills inaccessible** — no focus styles, not keyboard operable

### High-Impact Opportunities
1. **Design token system** — spacing, shadows, motion, typography scales
2. **Meaningful motion** — entrance stagger, data transitions, cross-filter feedback
3. **Progressive disclosure** — collapsible sections, density modes, drill-down
4. **Chart accessibility** — data tables as alternatives, better tooltips
5. **Bundle optimization** — lazy-load ECharts, split chat drawer

---

## Recommendation for Design Directions

Three distinct directions should explore:

1. **Direction 1: "Clarity First"** — Refine existing aesthetic with proper tokens, fix contrast, add subtle motion, improve density controls. Low risk, high polish.
2. **Direction 2: "Data Dense"** — Maximize information per pixel for power users: compact tables, sparklines in rows, multi-metric cards, keyboard-first. Higher density, steeper learning curve.
3. **Direction 3: "Guided Insight"** — Progressive disclosure with smart defaults: executive summary → drill paths, annotated charts, contextual help. More opinionated, better for occasional users.

All three must maintain: dark-only, contract immutability, stack lock, +50KB bundle budget, WCAG AA, determinism boundary.