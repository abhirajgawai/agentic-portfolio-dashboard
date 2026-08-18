# Direction 1 — "Clarity First" (Refined. Accessible. Calm.)

**Date:** 2026-08-18 · **Author:** ui-designer · **Tagline:** *Refined · Accessible · Calm*

---

## 1. Concept

The dashboard already works well — this direction treats it like a **product polish pass**, not a rebuild. Keep the information architecture exactly as-is (the 6 tabs, the JSON contract, the deterministic boundary), but fix every jagged edge the audit found: introduce a proper token system (spacing, shadows, motion, typography), repair the WCAG AA contrast failure on `--loss`, add a restrained motion language that makes data changes *felt* rather than *shown off*, and give users a density toggle so the same screen serves glance-and-go users and analysts alike. The aesthetic is "Linear on a calm day": deep neutral backgrounds, one primary accent (indigo), semantic colors used strictly for meaning, hairline borders, soft elevation instead of heavy shadows. Nothing animates for its own sake — every transition carries information (new data arrived, a filter changed, a card is interactive).

---

## 2. Mood Board

| Reference | What to borrow |
|---|---|
| **Linear.app** | Density toggle (comfortable/compact) persisted in localStorage; hairline `1px` borders instead of shadows; subtle `hover` elevation (2px lift, no shadow change); staggered card entrance (~80ms) |
| **Vercel Dashboard** | Stat cards: label (11px muted) / value (24px semibold tabular) / delta chip (12px, gain/loss colored); the "as of" timestamp as a quiet footnote, not a banner |
| **Stripe Dashboard** | Table design: sticky header with `bg-background/80 backdrop-blur`, column hover tint, right-aligned numeric columns, keyboard-sortable headers (`aria-sort`, focus ring) |
| **Notion** | Empty states with a single actionable CTA; calm muted secondary text; generous whitespace at the top of each screen |
| **GitHub** | Keyboard shortcuts (`R` = refresh, `/` = focus search, `?` = help dialog); subtle `:focus-visible` ring (2px, offset 2px) |

**Design language summary:** *Quiet surfaces, loud data.* The background stays near-black; cards lift by 2–3 L steps max; the only saturated elements are semantic (gain/loss/warning) and the primary accent.

---

## 3. Token Diff

### Colors (index.css `:root`)

| Token | Current | Proposed | Why |
|---|---|---|---|
| `--background` | `oklch(0.13 0.006 285)` | `oklch(0.13 0.006 285)` | **Unchanged** — good base |
| `--card` | `oklch(0.165 0.007 285)` | `oklch(0.155 0.008 285)` | Slightly darker so cards *with* elevation stand out; elevation now comes from borders not bg |
| `--loss` | `oklch(0.63 0.2 25)` | `oklch(0.70 0.17 25)` | **A11y fix:** raises contrast on `--background` from 4.2:1 → **5.3:1** (passes AA for normal text) |
| `--gain` | `oklch(0.72 0.15 155)` | `oklch(0.74 0.14 155)` | Slight lift for consistency (5.1 → 5.9:1) |
| `--warning` | `oklch(0.8 0.14 85)` | `oklch(0.82 0.13 85)` | Nudge only (7.2 → 7.8:1) |
| `--border` | `oklch(0.26 0.012 285)` | `oklch(0.24 0.012 285)` | Slightly softer so hairline borders recede further |
| `--muted-foreground` | `oklch(0.66 0.012 285)` | `oklch(0.68 0.012 285)` | Small lift for 12px labels (5.8 → 6.4:1) |
| `--primary` | `oklch(0.68 0.16 262)` | `oklch(0.70 0.16 262)` | Brighter accent for the brand mark + focus ring only |
| `--chart-*` | 5 tokens | **9 tokens** (`--chart-1..9`) | Extend palette so the ECharts `CATEGORY_COLORS` array can map 1:1 to CSS vars (audit §1: mismatch) |

### New: Motion Tokens
```css
:root {
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 350ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);      /* expo-out: entrance, growth */
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);  /* standard: state changes */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* pop: badges, chips */
}
```

### New: Elevation (Shadow) Tokens
```css
:root {
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.2);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.35), 0 2px 4px -2px rgba(0,0,0,0.3);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.4), 0 4px 6px -4px rgba(0,0,0,0.35);
  --shadow-focus: 0 0 0 2px var(--background), 0 0 0 4px var(--ring);
}
```

### New: Spacing Scale
```css
:root {
  --spacing-1: 4px;  --spacing-2: 8px;  --spacing-3: 12px;
  --spacing-4: 16px; --spacing-5: 24px; --spacing-6: 32px;
  --spacing-7: 48px; --spacing-8: 64px;
}
```

### New: Density Tokens
```css
:root {
  --row-height: 40px;        /* comfortable (default) */
  --row-padding-x: 12px;
  --table-font-size: 14px;
  --density: comfortable;
}
html[data-density='compact'] {
  --row-height: 30px;
  --row-padding-x: 8px;
  --table-font-size: 13px;
  --density: compact;
}
```

---

## 4. Component Anatomy Table

| Current | Proposed (variants / states / props added) |
|---|---|
| `AppShell` | Add **density toggle** (icon button in header, `data-density` on `<html>`); add **keyboard shortcut map** (`R`, `/`, `?`); skeleton for the shell itself during first load |
| `StatusBar` | Add focus ring to refresh button; add `aria-live="polite"` for refresh completion toast; stale badge gets `animate-pulse` (2s) |
| `LoadingState` | Screen-aware skeletons: Overview gets 4 card skeletons + 1 tall chart skeleton; table screens get 6 row skeletons; split into `ScreenSkeleton` variants |
| `ErrorState` | Add `kind: 'network' \| 'contract' \| 'pipeline'` prop → tailored copy + retry behavior |
| `EmptyState` | Add optional `action: {label, onAction}` slot (e.g. "Run snapshot now") |
| `Card` | Add `elevation: 'flat' \| 'raised'` variant (raised = `--shadow-sm` + `border`), `interactive` variant (hover lift 2px) |
| `HoldingsTable` | **Density-aware** (row height from `--row-height`); **keyboard sortable** (headers get `tabIndex=0`, `aria-sort`, Enter/Space to toggle); sticky header `backdrop-blur`; `scope="col"` on `<th>`; column hover tint |
| `OverviewCards` | Split delta chip out: `deltaChip: {value, direction, icon}` with `animate-in` on change; value uses `text-2xl font-semibold tabular-nums` |
| `AllocationDonuts` | Center label gets the top slice's **name** as `title` attribute; add `<table>` hidden accessibility alternative per donut |
| `TrendChart` | Add **dataZoom slider** (ECharts built-in, ~10KB) with `throttle: 60`; tooltip shows full date `YYYY-MM-DD`; add range-preset pills (1M / 3M / 6M / 1Y / All) |
| `FilterBar` (new, extracted) | Shared geography/asset-class pill group; pills get `focus-visible` ring + `aria-pressed`; active pill uses `bg-background shadow-sm` (current look, formalized) |
| `ChatDrawer` | Add `role="log"` + `aria-live="polite"` to message list; streaming indicator uses `--ease-spring` dots |
| `XirrCards` | Add `badge` for "no captured trades yet" honesty state (unchanged info, better styled) |

---

## 5. Screen Wireframes

### Overview
```
┌──────────────────────────────────────────────────────────────┐
│ Header: ● Portfolio | [Overview][India][US][Returns][Alerts]  │  ⚙ density ▸ 💬 chat 👁
│ StatusBar: ●live | as of 06:20 IST | platforms… | ⚠1 alert | ⟳ Refresh
├──────────────────────────────────────────────────────────────┤
│  Net Worth      Day P&L        Simple Return   XIRR          │
│  ₹67.98L   ▴+0.03%  ₹186.63 ▴+0.03%  +46.48%      —          │  ← hover: card lifts 2px
│  (4 cards, entrance stagger 80ms)                             │
├──────────────────────────────────────────────────────────────┤
│  By geography  By platform  By sector      By asset class    │
│  ◔ IN 67%     ◔ groww 41%  ◔ 24 items…    ◔ MF 39%           │  ← click slice: filters table
│  ◔ US 33%     ◔ moomoo 33% …                                │  ← hover: ECharts emphasis
│  (4 donuts, 200px each)                                       │
├──────────────────────────────────────────────────────────────┤
│  Portfolio value over time    [1M][3M][6M][1Y][All]           │  ← range pills + dataZoom
│  ▁▂▃▅▆█▇▅▂▁ (area chart, draw 600ms on mount)                │  ← hover: crosshair tooltip
└──────────────────────────────────────────────────────────────┘
```

### Holdings (India/US share the same anatomy)
```
┌──────────────────────────────────────────────────────────────┐
│ [All][Zerodha][Groww][Sharekhan]  ·  [All][Equity][ETF][MF]   │  ← FilterBar (new component)
├──────────────────────────────────────────────────────────────┤
│ 35 holdings            [🔍 search…]                           │
│ ┌───────────────────────────────────────────────────────────┐│
│ │ Ticker ⇅   Name       Plat  Qty   Avg     LTP     Value ⇅ ││  ← sticky header, blur
│ │ APARINDS   —          Zero  21    ₹6,021  ₹16,789  ₹3.53L ││  ← row hover: bg-accent/40
│ │ …                                                          ││  ← click row: (future) drill modal
│ └───────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### Returns
```
┌──────────────────────────────────────────────────────────────┐
│ [All][India][US]  ·  [All][Equity][ETF][MF]                   │
├──────────────────────────────────────────────────────────────┤
│ Portfolio simple return: +46.48%   (48 w/cost · 20 without)   │
│ ████████████████████░░░░░ (bar: gain=green, loss=red)        │
├──────────────────────────────────────────────────────────────┤
│ Per-holding return (48 cost-bearing)  ← bars, 12px max       │
│ ████░░░  APARINDS  +178.8%                                   │
│ ░░░███  KPITTECH  −47.9%  ← hover: tooltip w/ value          │
├──────────────────────────────────────────────────────────────┤
│ Portfolio value over time (reused TrendChart)                 │
├──────────────────────────────────────────────────────────────┤
│ XIRR by account:  [zerodha__INR: —]  [moomoo__USD: —]        │
│   (honest "no captured trades yet" badge)                    │
└──────────────────────────────────────────────────────────────┘
```

### Alerts
```
┌──────────────────────────────────────────────────────────────┐
│ Fired alerts · evaluated 06:30 IST   [1 warn][0 crit][0 info] │
│ ┌───────────────────────────────────────────────────────────┐│
│ │ ⚠ holding_deep_loss      [warn]                           ││  ← severity icon + badge
│ │   Holding deep loss [KPITTECH]: −47.91% (lt −25%)          ││
│ │   @ 2026-08-18T06:30:29Z                                   ││
│ └───────────────────────────────────────────────────────────┘│
│ Empty state: 🔔 icon + "No alerts fired" + CTA               │
└──────────────────────────────────────────────────────────────┘
```

### Chat
```
┌──────────────────────────────────────────────────────────────┐
│ 🤖 Portfolio analyst ●online                        [✕]      │
│ ├───────────────────────────────────────────────────────────┤│
│ │ You: How many holdings do I have?                         ││
│ │ Bot: 68 holdings across 4 platforms…                      ││
│ │      [portfolio_data_latest_snapshot ✓]                   ││  ← tool-call chips
│ │      [portfolio_data_allocation_summary ✓]                ││
│ │ Thinking… ●●● (spring dots)                               ││
│ └───────────────────────────────────────────────────────────┘│
│ [Ask about your portfolio…                    ] [➤]          │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. Motion Specs

| Motion | Trigger | Duration | Easing | Stagger | Notes |
|---|---|---|---|---|---|
| Card entrance | Screen mount | 200ms | `--ease-out` | 80ms | `translateY(8px) → 0`, `opacity 0→1`, max 5 items |
| Chart draw | Mount / data change | 600ms | `--ease-out` | — | ECharts built-in `animationDuration: 600` |
| Delta chip change | New snapshot data | 400ms | `--ease-in-out` | — | Number counter 0→value (tabular-nums, no layout shift) |
| Row hover | Mouse enter | 120ms | `--ease-in-out` | — | `bg-accent/40`, no scale (avoids CLS) |
| Sort click | Header click | 200ms | `--ease-in-out` | — | Rows re-order instantly; `aria-sort` updates |
| Filter change | Pill click | 350ms | `--ease-out` | — | Rows cross-fade (`opacity 0.5 → 1`) + re-sort |
| Stale badge | Appears | pulse 2s | `--ease-in-out` | — | `opacity 0.6→1` pulse ×3, then steady |
| Refresh complete | API returns | toast 300ms in, 4s hold, 200ms out | `--ease-out` | — | `role="status"`, `aria-live="polite"` |
| Tab switch | Tab click | 150ms | `--ease-in-out` | — | Content cross-fade 150ms (no slide — avoids orientation surprises) |
| Skeleton → content | Data resolve | 200ms | `--ease-in-out` | — | Fade-out skeleton, fade-in content |

**Reduced motion** (`prefers-reduced-motion: reduce`): all durations → 0ms; no stagger; number counter jumps instantly; charts render without draw animation.

---

## 7. Trade-offs

| Axis | Choice | Cost |
|---|---|---|
| **Fidelity vs. rebuild** | Keep IA, polish surfaces | Less "wow", but zero regression risk; contract untouched; all 6 screens ship in one pass |
| **Density** | Two modes (comfortable/compact) | Double-testing burden per screen; some tables may need per-mode column tweaks |
| **Motion** | Restrained, information-only | Won't feel as "animated" as Direction 2/3; by design — motion should not compete with data |
| **A11y** | Full WCAG AA sweep incl. chart data tables | ECharts `<table>` fallbacks add markup; screen-reader QA time |
| **Bundle** | ~+25KB (dataZoom + minor) | Within +50KB budget comfortably |

**Who it serves:** Everyone, with no learning curve. Best default if the user wants "a better version of what I have."

---

## 8. Effort Estimate

| Screen / Component | Effort |
|---|---|
| Token system (colors/motion/elevation/spacing/density) | **M** |
| `--loss` contrast fix + palette extension | **S** |
| Density toggle + `data-density` wiring | **M** |
| HoldingsTable (keyboard sort, sticky header, density) | **M** |
| Screen-aware skeletons | **S** |
| Card variants (flat/raised/interactive) | **S** |
| FilterBar extraction | **S** |
| TrendChart dataZoom + range pills | **M** |
| Donut a11y fallbacks | **M** |
| OverviewCards delta chips + counters | **M** |
| ChatDrawer a11y (role=log, aria-live) | **S** |
| Entrance/transition motion pass | **M** |
| Keyboard shortcuts (R, /, ?) | **S** |
| **Total** | **~2–3 evenings** |
