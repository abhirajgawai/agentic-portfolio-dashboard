# Direction 2 — "Data Dense" (Power. Density. Speed.)

**Date:** 2026-08-18 · **Author:** ui-designer · **Tagline:** *Power · Density · Speed*

---

## 1. Concept

This direction is built for the **power user** who checks the dashboard twice a day and wants maximum signal per pixel. Keep the same data contract and the same 6 tabs, but radically increase information density: a default **compact density**, **sparklines in table rows** (7-day price trend per holding), **multi-metric stat cards** (value + day P&L + 7d change + coverage % in one tile), **keyboard-first navigation** (arrow keys move between holdings, `Shift+Tab` cycles filter groups, all sorting/filtering focus-visible), and a **sticky command bar** at the bottom with global actions (`/` to search any holding, `R` refresh, `?` shortcuts). Charts gain **dataZoom on everything**, and the holdings table becomes a dense grid where every cell earns its pixels. The aesthetic is "Bloomberg terminal meets Linear": compact typography, hairline grid lines, one accent color, semantic colors for P&L only.

> This is the direction that makes the app feel like a **serious instrument**, not a casual web page.

---

## 2. Mood Board

| Reference | What to borrow |
|---|---|
| **Bloomberg Terminal** | Extreme density tolerance; monospace-ish numeric columns; keyboard everything; no wasted whitespace |
| **Linear.app (compact mode)** | Compact density token; command palette (`Cmd+K`) with fuzzy search of holdings/actions; keyboard-first |
| **TradingView watchlists** | In-row sparklines (7d mini area chart per ticker); right-aligned numeric columns; column resize handles |
| **Stripe Dashboard (dense)** | Table with sticky first column on mobile; column width memory (persist to localStorage); hover row = subtle tint |
| **Raycast** | Global command bar, fuzzy search, action lists with shortcut hints on the right |

**Design language summary:** *Everything visible, nothing wasted.* 13px base font, 30px rows, multi-line cards where data warrants, sparklines instead of text-only deltas.

---

## 3. Token Diff

### Colors
| Token | Current | Proposed | Why |
|---|---|---|---|
| `--background` | `oklch(0.13 0.006 285)` | `oklch(0.12 0.007 285)` | Deeper backdrop makes hairlines + accent pop more |
| `--card` | `oklch(0.165 0.007 285)` | `oklch(0.145 0.008 285)` | Cards get elevation via `--shadow-sm` + border, not bg lift |
| `--loss` | `oklch(0.63 0.2 25)` | `oklch(0.70 0.17 25)` | **A11y fix** (same as D1: 5.3:1) |
| `--gain` | `oklch(0.72 0.15 155)` | `oklch(0.74 0.14 155)` | Consistent with D1 |
| `--muted-foreground` | `oklch(0.66 0.012 285)` | `oklch(0.68 0.012 285)` | 13px labels need the extra contrast |
| `--border` | `oklch(0.26 0.012 285)` | `oklch(0.24 0.012 285)` | Hairline grid lines recede |
| `--primary` | `oklch(0.68 0.16 262)` | `oklch(0.72 0.16 262)` | Brighter accent for the single saturated element |
| `--chart-*` | 5 | **9** (`--chart-1..9`) | Sparklines need their own palette entries; donut + sparkline share tokens |

### New: Typography Scale (Compact-first)
```css
:root {
  --text-2xs: 11px;   /* table meta, badges */
  --text-xs: 12px;    /* table cells (comfortable uses 13px) */
  --text-sm: 13px;    /* base body */
  --text-md: 15px;    /* card values */
  --text-lg: 18px;    /* stat card value */
  --text-xl: 24px;    /* hero value */
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  /* numeric cells default to --font-mono for aligned columns */
}
```

### New: Density Tokens (Compact is DEFAULT)
```css
:root {
  --row-height: 30px;        /* compact (default) */
  --row-padding-x: 8px;
  --table-font-size: 12px;
  --density: compact;
}
html[data-density='comfortable'] {
  --row-height: 40px;
  --row-padding-x: 12px;
  --table-font-size: 14px;
  --density: comfortable;
}
```

### New: Motion Tokens (same as D1 — motion is secondary in this direction)
```css
:root {
  --duration-fast: 100ms;  --duration-base: 180ms;  --duration-slow: 300ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}
```

### Shadow / Spacing Tokens
Same set as Direction 1 (`--shadow-xs..lg`, `--spacing-1..8`) — the skeleton is shared; the *defaults* differ (D2 defaults to compact density, mono numerals, 13px base).

---

## 4. Component Anatomy Table

| Current | Proposed |
|---|---|
| `AppShell` | Add **CommandBar** (bottom, global: `/` search, `R` refresh, `?` shortcuts); density toggle in header; keyboard map with visible hints |
| `StatusBar` | Merge into a **single-line compact bar**: `as-of | platforms dots | alerts count | density | refresh` — all at 12px |
| `LoadingState` | Compact skeletons: table screens show 10 row skeletons at 30px; no card skeletons (data-dense = show the grid shape) |
| `HoldingsTable` | **Dense grid**: 30px rows, 12px cells, `--font-mono` numerics, **in-row sparkline** column (7d from `history.byPlatform`), column resize, **sticky first column** (ticker) on mobile, sticky header, keyboard sort (`tabIndex=0`, `aria-sort`, Enter/Space), arrow-key row navigation (`aria-activedescendant`) |
| `OverviewCards` | **Multi-metric cards**: Net Worth tile shows `value / dayPnl / 7d% / coverage` in 2×2 mini-grid; single 44px hero number + 3 sub-metrics |
| `AllocationDonuts` | **Collapsible**: default shows only top-5 slices per donut with "show all" toggle; donut height shrinks 200→160px; legend inline (no scroll page) |
| `TrendChart` | dataZoom always-on + range pills + **compare mode** (toggle overlay of a platform vs portfolio) |
| `ReturnBars` | Add value labels at bar ends; gridline every 10%; height cap 400px (denser) |
| `FilterBar` (new) | Compact pill row at 12px, `aria-pressed`, focus ring, `Shift+Tab` moves between groups |
| `ChatDrawer` | **Collapsible to a floating button** when not in use (dense users don't want a 400px panel); messages at 12px |
| `CommandBar` (new) | Fixed bottom center; `Cmd+K`/`/`; fuzzy-matches holdings, tabs, actions (refresh, toggle privacy, density) |

---

## 5. Screen Wireframes

### Overview (dense)
```
┌──────────────────────────────────────────────────────────────┐
│ ● Portfolio  [Ov][IN][US][Ret][Alrt]    ⬒ ▬  👁 ⟳            │  ← single-line header, 12px
│ as-of 06:20 IST · ●● ●● platform dots · ⚠1 · [▣] [🧷]        │  ← StatusBar merged, 12px
├──────────────────────────────────────────────────────────────┤
│ NetWorth ₹67.98L     Day ₹186.63        Return +46.48%       │
│  dayPnl ▴0.03%       7d ▴1.2%           cov 48/68            │  ← 2×2 mini-grid cards
│  7d ▴1.2%            return ▴0.03%      XIRR —               │
├──────────────────────────────────────────────────────────────┤
│ Geog  IN ██████████ 67%               Sector  [top-5 + ▾]    │
│       US ████ 33%                       Semicon 12.4%        │  ← top-5 default, expandable
│ Plat  groww ███████ 41%                Asset   MF 39%        │
│       moomoo █████ 33%                       ETF 26%         │
│  (4 compact donuts, 160px)                  EQ 35%           │
├──────────────────────────────────────────────────────────────┤
│ Trend  [1M][3M][6M][1Y][All]  [∥ compare]  ⤢ dataZoom       │
│ ▁▂▃▅▆█▇▅▂▁ (600ms draw, zoom drag)                           │
└──────────────────────────────────────────────────────────────┘
```

### Holdings (the star of this direction)
```
┌──────────────────────────────────────────────────────────────┐
│ [All][Zero][Groww][SK] [All][EQ][ETF][MF]         [🔍 search] │
├──────────────────────────────────────────────────────────────┤
│ 35  ⇅Ticker ⇅Name  ⇅Plat  ⇅Qty ⇅Avg  ⇅LTP  ⇅Val  ⇅Day ⇅Ret ▒│
│ SPARK APARINDS  —    Zero   21  6.0K 16.8K 3.53L ▴1.6 +178% ││  ← sparkline col
│ SPARK LT        —    Zero    3  1.1K  4.1K 12244 ▾0.1 +258% ││  ← mono numerals
│ SPARK SMH       —    Moomoo 13  414   594   7.8K ▴0.0  +43% ││  ← sticky ticker col
│ ...                                                          ││  ← arrow-key nav
└──────────────────────────────────────────────────────────────┘
[ / ]  search holdings, tabs, actions…                     ⌘K
```

### Returns / Alerts / Chat
- **Returns:** bars with end-labels + `10%` gridlines; trend chart reused with compare mode.
- **Alerts:** dense list — icon + ruleId + message on ONE line (wrap only on mobile); severity badge at 10px.
- **Chat:** floating `💬` button → slides a 360px panel; messages 12px; suggestion chips as single-line pills.

---

## 6. Motion Specs

| Motion | Trigger | Duration | Easing | Notes |
|---|---|---|---|---|
| Sparkline draw | Row mount | 400ms | `--ease-out` | ECharts mini-chart per row (only when scrolled into view — `IntersectionObserver`) |
| Row navigation | Arrow key | 100ms | `--ease-in-out` | `bg-accent` moves instantly (fast = feels precise) |
| Filter change | Pill click | 180ms | `--ease-in-out` | Rows re-order instantly; **sparklines persist** (no flicker — reuse element) |
| Command bar open | `⌘K` / `/` | 150ms | `--ease-out` | `scale(0.98)→1` + `opacity 0→1`, from bottom |
| Command fuzzy filter | Keystroke | 80ms | — | Instant list reorder (no stagger — speed is the point) |
| Data refresh | New snapshot | 400ms | `--ease-in-out` | Number counters + sparkline morph in place |
| Donut expand | "show all" click | 200ms | `--ease-out` | Height 160→240px, slices fade in stagger 30ms |
| Chat panel | Toggle | 200ms | `--ease-out` | Slide from right 360px |

**Reduced motion:** all → 0ms; sparklines render static; command bar appears instantly.

---

## 7. Trade-offs

| Axis | Choice | Cost |
|---|---|---|
| **Density** | Compact by default | 13px/30px rows strain casual/mobile users; touch targets < 44px on mobile need mitigation (density auto-switches to comfortable under 640px) |
| **Sparklines** | In every row | +per-row chart instances → memory; mitigated with IntersectionObserver + ECharts dispose-on-scroll-out; +bundle (reuses existing ECharts core) |
| **Complexity** | Command bar, column resize, arrow-key nav | More states to build/test; keyboard semantics (roving tabindex) are fiddly |
| **A11y** | Dense text at 12px with AA contrast | 12px is below the 13px comfort threshold; AA maintained but not "comfortable reading" |
| **Effort** | Highest of the three | ~4–5 evenings |
| **Mobile** | Auto-switch to comfortable density | Two layouts to maintain per screen |

**Who it serves:** A single-user, daily-ritual power user who hates scrolling. Strongest "wow" for someone who lives in the app.

---

## 8. Effort Estimate

| Screen / Component | Effort |
|---|---|
| Token system (density-first, typography, mono) | **M** |
| Compact density default + auto-mobile-switch | **M** |
| HoldingsTable dense grid (sparklines, sticky col, resize, arrow-nav) | **L** |
| Multi-metric OverviewCards (2×2 mini-grid) | **M** |
| CommandBar (fuzzy search + shortcuts) | **L** |
| Collapsible donuts (top-5 + expand) | **M** |
| TrendChart compare mode + dataZoom | **M** |
| ReturnBars end-labels + gridlines | **S** |
| Dense Alerts single-line rows | **S** |
| Chat floating button + 360px panel | **M** |
| Keyboard nav + aria-activedescendant | **L** |
| **Total** | **~4–5 evenings** |
