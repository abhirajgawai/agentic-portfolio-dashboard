# Sidebars Redesign — UniversePane & ContextRail

**Tagline:** Fix the broken, use what exists.

**Concept:** The two sidebars were sketched as placeholders during the Journey OS
round-2 build but never received real polish. This spec fixes the broken parts
(collapsed state, dead CSS classes, disconnected filters, missing alerts) and
wires them into the production components already built for the center pane --
specifically the `HoldingsTable` (TanStack Table, keyboard nav, sparklines,
sorting) and the `AllocationDonuts` (real ECharts mini-donuts). The goal is not
a visual reinvention; it is to make the sidebars work as well as the center
pane already does, with the same visual language and the same data plumbing.

---

## 1. What to keep (already works)

| Element | Why it stays |
|---|---|
| `HoldingsTable` component (363 lines) | TanStack Table v8, keyboard-sortable headers, roving tabindex, sparklines, aria-sort -- this IS the holdings table. UniversePane should delegate to it, not reimplement a hand-rolled `<table>`. |
| `AllocationDonuts` component (63 lines) | Real ECharts donuts with `donutOption()`. Already renders 4 donuts in the Overview tab. AllocationLens should use this (scaled down), not legend dots. |
| `useLatest()` / `useHistory()` / `useAlerts()` hooks | All exist in `data.ts`. ContextRail just needs to call `useAlerts()` -- it currently does not. |
| `formatInrCompact()` / `platformLabel()` | Already used by UniversePane rows. Keep. |
| `usePrivacy()` mask toggle | Both panes already respect it. Keep. |
| `platform` badge colors | The 5 platform color classes (blue/purple/emerald/orange/amber) are consistent and readable. Keep. |
| `bg-sidebar` class on both panes | This class resolves to the CSS custom property `--sidebar` (provided by shadcn/ui base layer). It is the correct semantic token for sidebar backgrounds. Keep. |
| HealthTicker footer | Already provides platform freshness at the bottom. The ContextRail staleness section should NOT duplicate this -- it should surface only actionable staleness (threshold exceeded), not repeat the footer per-platform pills. |

---

## 2. What to change (specific before/after)

### 2.1 UniversePane

#### 2.1.1 Replace hand-rolled table with HoldingsTable

**Before (current, 210 lines):**
UniversePane contains a hand-rolled `<table>` with 3 columns (Ticker, Name, Value),
inline platform badges, naive `slice(0, 8)` truncation, dead CSS classes (`aria-selected`
used as a className, `data-[state=selected]:bg-accent/20` targeting nothing), and no
keyboard navigation.

**After:**
UniversePane imports and renders `HoldingsTable` with the following props:

```
<HoldingsTable
  holdings={filtered}
  displayCurrency="INR"
  platformVisible={true}
  onSelect={onSelect}
  selectedTicker={selectedTicker}
  selectedTickerSet={setSelectedTicker}
  showSparkline={false}
/>
```

The `HoldingsTable` already handles:
- TanStack Table sorting (all columns sortable, keyboard-sortable headers)
- Arrow-key row navigation (up/down/Home/End, roving tabindex)
- `aria-selected` on the active row (as a data attribute, not a dead CSS class)
- Global filter (search) -- but UniversePane keeps its OWN search input above the
  table (the table built-in search is hidden via prop or by not passing `globalFilter`
  to the table -- see section 2.1.3)
- Platform badge rendering
- Privacy mask

**What HoldingsTable does NOT have that UniversePane needs:**
- The header should show "Holdings" + count + a collapse toggle (section 2.1.2)
- The ticker column should NOT show avg price, LTP, qty, day%, or return% -- those
  are center-pane detail. The sidebar row is a navigation item, not a data table.

**Design decision:** Use `HoldingsTable` in a **compact column subset** mode. Add an
optional `columns` prop or a `variant="sidebar"` prop that shows only: Ticker (+ platform
badge), Name, Value. This keeps one component, two modes.

**Alternative considered:** Keep the hand-rolled table and just fix the CSS classes.
**Rejected because:** duplicating keyboard nav, sorting, and aria semantics across two
tables is a maintenance burden and a consistency risk. The `HoldingsTable` already
solves these problems.

#### 2.1.2 Header: title + count + collapse

**Before:**
```
<h2>Holdings</h2>
<span>{filtered.length}</span>
```
Plus a standalone collapse button below the header (odd placement).

**After:**
```
+---------------------------------------------+
| Holdings  68          [<] collapse           |  <-- single row, 40px height
| ------------------------------------------- |
| (search) Search...                          |
| ------------------------------------------- |
| [FilterBar: IN . US . Equity . ...]         |  <-- optional pills row
| ------------------------------------------- |
| [table rows]                                |
+---------------------------------------------+
```

Header anatomy:
- Left: "Holdings" in `text-xs font-semibold text-foreground` (not uppercase --
  matches WorkspaceCenter tab labels)
- Center: count badge `text-xs text-muted-foreground tabular-nums`
- Right: collapse toggle `ChevronLeft` ghost button (size 7, `aria-label="Collapse sidebar"`)
- Background: `bg-sidebar` (current, correct)
- Border-bottom: `border-b border-border`
- Height: `h-10` (40px) -- matches the WorkspaceCenter tab bar height

When collapsed:
- Pane width animates from 256px to 0px (or hides entirely)
- A thin vertical strip with `ChevronRight` remains on the left edge
- The `.collapsed` CSS class is IMPLEMENTED: `width: 0; overflow: hidden; opacity: 0;
  pointer-events: none;` with `transition: width var(--duration-base) var(--ease-out),
  opacity var(--duration-fast)`

#### 2.1.3 Search input

**Before:** `<Input>` with `h-8 pl-7 pr-2 text-sm` -- works but the icon size is
inconsistent (`size-3.5`).

**After:** Same input, tightened:
- Height: `h-7` (28px) -- sidebar density
- Icon: `size-3` (12px) -- consistent with the smaller context
- Placeholder: "Search..." (shorter, the "ticker / name" is obvious)
- Border: `border-border/50` (subtler)
- On focus: `ring-1 ring-ring` (standard shadcn focus)

#### 2.1.4 FilterBar (geography / asset class pills)

**Before:** Comment says it should exist. It does not.

**After:** A row of toggle pills between search and the table:

```
[IN .] [US .] [Equity .] [MF .] [ETF .] [Property .]
```

- Each pill: `rounded-full px-2 py-0.5 text-[11px] font-medium border border-border/50`
- Active: `bg-primary/10 text-primary border-primary/30`
- Inactive: `text-muted-foreground hover:text-foreground hover:border-border`
- `aria-pressed` on each pill
- Clicking toggles a local filter (geography or assetClass)
- These filters combine with the search input (AND logic)
- The ContextRail AllocationLens can ALSO set these (cross-filter) -- see section 2.2.4

**Dimensions exposed:** geography (IN/US), assetClass (equity/mutual_fund/etf/real_estate).
Platform is already visible as badges; sector is too granular for pill toggles.

#### 2.1.5 Row anatomy (when using HoldingsTable in sidebar mode)

**Before (hand-rolled):**
```
| KPITTECH   [Zerodha] | K.P. Technology | Rs.1,23,456 |
| SMH        [Moomoo]  | VanEck Semi     | Rs.17,10,000|
```

**After (HoldingsTable sidebar variant):**
```
| KPITTECH  [Zer] | K.P. Technology Ltd  | Rs.1.23L  |
| SMH       [Moo] | VanEck Semi ETF      | Rs.17.10L |
```

- Ticker: `text-xs font-medium tabular-nums` -- NO truncation hack. Tickers are
  max 12 chars (NSE) or 5 chars (NASDAQ). The `slice(0, 8)` was solving a problem
  that does not exist. If a ticker is genuinely long (e.g. NSE INFYBEES), truncate
  at 10 chars with ellipsis (CSS `overflow-hidden text-ellipsis`).
- Platform badge: small pill, 2-3 letter abbreviation (Zer, Moo, Grw, Shk, RE)
  via `platformLabel()`. Keep existing color scheme.
- Name: `text-xs text-muted-foreground truncate` -- max width `max-w-[120px]`
- Value: `text-xs font-medium tabular-nums text-right` -- `formatInrCompact()`
- Row height: `h-8` (32px) in comfortable mode, `h-6` (24px) in compact
- Selected row: `bg-accent/40` (existing HoldingsTable class)
- Hover: `hover:bg-accent/20` (existing)

#### 2.1.6 Keyboard interactions

All handled by `HoldingsTable` existing keyboard support:
- **ArrowUp/ArrowDown** Arrow keys: move selection (roving tabindex)
- **Home/End**: jump to first/last row
- **Enter/Space**: select row (opens dossier in center)
- **Tab**: moves to next focusable element (search input -> table -> collapse button)
- **Escape** (when search focused): clears search, returns focus to table

New: **Ctrl+F** or **/** (when UniversePane is focused): focuses the search input.
This matches the Linear/Vercel convention.

#### 2.1.7 Mobile (below 768px)

**Before:** `!isMobile` hides the entire pane.

**After:**
- On mobile, the UniversePane becomes a **full-screen overlay** (slide-in from left)
- Trigger: a "Holdings" button in the WorkspaceCenter tab bar (or a hamburger)
- Back button in the header returns to the center pane
- The overlay has a close button (X) in the top-right
- Background: `bg-background` with `z-modal` overlay
- Transition: `translate-x` slide, 250ms ease-out

#### 2.1.8 Collapse behavior

**Before:** `.collapsed` class is undefined. Toggle does nothing visually.

**After:**
- Collapse state managed in `AppShell` (lifted from UniversePane)
- When collapsed: pane width goes to 0, overflow hidden, opacity 0
- A thin 32px-wide vertical strip shows on the left edge with a `ChevronRight` button
- Clicking expands back to 256px
- Transition: `width 250ms var(--duration-base) var(--ease-out), opacity 150ms`
- `aria-expanded` on the toggle button
- Keyboard: **Ctrl+[** toggles collapse (matching VS Code sidebar toggle)

---

### 2.2 ContextRail

#### 2.2.1 Replace AllocationLens with mini AllocationDonuts

**Before (AllocationLens, 184 lines):**
A tab bar (Geography/Platform/Sector/Asset Class) + a 2-column grid of buttons
with legend dots. No actual charts. Dead `data-[state=active]` CSS class.
Filter callbacks are all no-ops.

**After:**
Use the existing `AllocationDonuts` component but in a **compact sidebar variant**.

**Design decision:** Add a `variant="sidebar"` prop to `AllocationDonuts` (or create
a `MiniDonut` wrapper) that renders:
- One donut at a time (the active dimension)
- 64px x 64px EChart donut (vs 200px in the Overview tab)
- Center label: top category name (e.g. "IN 62%")
- Below the donut: the dimension tabs as small pills
- Below the tabs: the top 3-4 slices as a compact legend with colored dots + percentage

```
+---------------------------------------------+
| Allocation                                   |
| ------------------------------------------- |
|     +----------+                             |
|     |  IN 62%  |  <-- 64px mini donut       |
|     |  xxxxxx  |      EChart                 |
|     +----------+                             |
| [Geo] [Plat] [Sect] [Asset]                 |  <-- dimension tabs
| ------------------------------------------- |
| o IN 62%  o US 38%                          |  <-- top slices legend
| ------------------------------------------- |
| [Clear filters]                              |  <-- when filters active
+---------------------------------------------+
```

**Why mini donuts and not legend dots:**
- The legend dots in AllocationLens provide zero visual information -- a colored circle
  next to "Banking: 27%" is just text with decoration
- A 64px donut gives instant proportional understanding (the eye sees "IN is bigger
  than US" faster than reading "62% vs 38%")
- ECharts already handles the rendering, tooltip, and responsive resize
- The Overview tab 200px donuts prove the approach works; scaling down is trivial
  via the `height` prop on `EChart`

**Why not all 4 donuts simultaneously:**
- 256px sidebar width cannot fit 4 donuts legibly (even 2 side-by-side = 120px each,
  too small for 8+ sector slices)
- One donut at a time with dimension tabs is the standard pattern (Linear sidebar
  filters, Stripe breakdown panels)

#### 2.2.2 Dimension tabs

**Before:** 4 plain buttons with `data-[state=active]:bg-accent/20` (dead class).

**After:**
- Horizontal pill row, same style as the UniversePane FilterBar (section 2.1.4)
- Active: `bg-primary/10 text-primary`
- Inactive: `text-muted-foreground hover:text-foreground`
- `role="tablist"` on the container, `role="tab"` on each pill, `aria-selected`
- Keyboard: left/right arrow keys cycle between tabs (roving tabindex)
- Default: Geography (most common filter)

#### 2.2.3 Clickable donut slices = filters

**Before:** `toggleFilter={() => {}}` -- no-op.

**After:**
- Clicking a donut slice toggles that value as a filter
- The slice highlights (full opacity), others dim (0.3 opacity)
- A "clear" button appears below the legend when any filter is active
- Active filters are shown as small removable chips below the donut:
  `IN x` `US x` (click x to remove)
- Filters propagate to:
  - UniversePane (filtered holdings list)
  - India/US/Returns workspaces (filtered tables/charts)
  - **NOT** JourneyWorkspace (per spec: "Journey is never filtered")
- Filter state is managed in `AppShell` (lifted), passed down to both panes

#### 2.2.4 Attention Rail (below allocation)

**Before:**
- Stale platforms section (duplicated from HealthTicker)
- "Biggest movers" section (misleading -- shows portfolio-level date changes, not holding movers)
- No alerts section (despite the spec promising it)

**After:**
Three sections, stacked vertically:

**A. Alerts (top priority)**

```
+---------------------------------------------+
| Alerts  2                                     |
| ------------------------------------------- |
| [!] holding_deep_loss [KPITTECH]             |  <-- warn: amber
|   -45.74% from cost                           |
| [i] platform_stale_data [moomoo]             |  <-- info: muted
|   8.00d past threshold                        |
+---------------------------------------------+
```

- Call `useAlerts()` (currently NOT called in ContextRail)
- Each alert: severity icon (AlertCircle for warn/critical, Info for info) + rule
  ID + target + message
- Colors: `text-warning bg-warning/10` for warn, `text-loss bg-loss/10` for critical,
  `text-muted-foreground bg-muted/50` for info
- Header shows count badge when alerts > 0
- Empty state: "All caught up" with a check icon (calm, not alarming)
- Click an alert navigates to the Alerts workspace (center pane)
- Max 5 visible, "Show all" link when more

**B. Data freshness (only actionable items)**

```
+---------------------------------------------+
| [!] moomoo -- 8d stale                       |
|   Threshold: 2d                               |
+---------------------------------------------+
```

- Only show platforms where `stale === true` (threshold exceeded)
- Do NOT duplicate the HealthTicker per-platform freshness pills (which show
  ALL platforms, fresh and stale)
- Style: same as current (`bg-warning/10 text-warning`)
- If no stale platforms: section hidden entirely (not "all caught up" -- absence
  of staleness is normal, not noteworthy)

**C. Top movers (renamed from "Biggest movers")**

```
+---------------------------------------------+
| Top movers today                              |
| ------------------------------------------- |
| ^ KPITTECH  +Rs.1,234  +2.3%                |
| v SMH       -Rs.890    -1.1%                |
| ^ INFY      +Rs.456    +0.8%                |
+---------------------------------------------+
```

- Source: `performance.json` -> `daily[latest].topMovers` (already computed by the
  pipeline, already in the contract) -- NOT the misleading date-over-date portfolio
  changes from `history.json`
- Shows the top 3 movers by `|dayPnlBase|` for the latest day
- Each row: arrow icon (gain/loss) + ticker + day P&L amount + day P&L %
- Click a ticker opens dossier in center pane
- If no performance data: section hidden

**Empty state (all three sections clear):**

```
+---------------------------------------------+
| [check] All caught up                         |
|   No alerts, all data fresh.                  |
+---------------------------------------------+
```

#### 2.2.5 Staleness rendering fix

**Before:** `new Date()` called in render body -- freezes the staleness calculation
until the next refetch.

**After:** Use `useMemo` with the data dependency:

```
const platformStaleness = useMemo(() => {
  return Object.entries(data?.platforms ?? {}).map(([name, p]) => {
    // ...same calculation, but now recomputes when `data` changes
  })
}, [data?.platforms])
```

#### 2.2.6 Dead props cleanup

**Before:** `onToggleCollapse` accepted but never used. `isCollapsed` accepted
but the collapse animation is broken (same `.collapsed` issue as UniversePane).

**After:** Remove `onToggleCollapse` from the interface. Collapse is managed
by `AppShell` (same as UniversePane). The `.collapsed` class is implemented
(see section 2.1.8).

#### 2.2.7 Mobile (below 768px)

**Before:** Hidden entirely (`!isMobile && !chatOpen`).

**After:**
- On mobile, ContextRail becomes a **bottom sheet** (slide up from bottom)
- Trigger: a "Context" button in the bottom action bar (or a gesture)
- Shows only the Alerts section and the active donut (no room for full layout)
- Backdrop overlay, drag-down to dismiss
- Max height: 50vh

---

### 2.3 Shared visual treatment

#### 2.3.1 Panel background

Both sidebars currently use `bg-sidebar`. This is correct -- shadcn/ui defines
`--sidebar` as the semantic token for sidebar backgrounds. The round-2
tokens.json introduced a `panel` token that is NOT in index.css. Decision:

**Use `bg-sidebar` (current).** The `panel` token is defined in tokens.json but
was never wired into index.css. Adding it now would be a separate concern.
`bg-sidebar` already resolves correctly in both themes via shadcn base layer.

If the `panel` token is added to index.css later, both sidebars should migrate
to `bg-panel` for visual differentiation from the center pane `bg-background`.

#### 2.3.2 Border treatment

**Before:**
- UniversePane: `border-r border-border`
- ContextRail: `border-l border-border`

**After:** Same. The 1px border in `--border` color is the correct separator.
No change needed.

#### 2.3.3 Header style consistency

Both sidebars should use the same header pattern:

```
+-----------------------------+
| [Title]          [count] [?]|  <-- 40px height
+-----------------------------+
```

- Title: `text-xs font-semibold text-foreground` (not uppercase)
- Count: `text-xs text-muted-foreground tabular-nums`
- Action button: ghost, size-7, `text-muted-foreground hover:text-foreground`
- Border-bottom: `border-b border-border`
- Padding: `px-3 py-2.5`

#### 2.3.4 Spacing rhythm

Both sidebars use the same internal spacing:
- Section gap: `space-y-3` (12px between major sections)
- Inner padding: `px-3` (12px horizontal)
- Item gap: `space-y-1.5` (6px between list items)
- Border between sections: `border-b border-border/30` (subtle divider)

#### 2.3.5 Width

**Before:** Both `w-64` (256px).

**After:** Keep `w-64`. The 256px width is sufficient for:
- Holdings rows (ticker + badge + name + value = ~240px usable)
- 64px mini donut + legend (240px usable)
- Attention rail cards (240px usable)

The WorkspaceCenter gets `flex-1` which fills the remaining space. On a 1440px
screen: 256 + flex-1 + 256 = 928px for center. On 1280px: 256 + 768 + 256 = fine.
Below 768px: sidebars become overlays (sections 2.1.7, 2.2.7).

---

## 3. Cross-filter plumbing

The ContextRail AllocationLens donut clicks should filter the UniversePane and
center-pane workspaces. This requires lifting filter state to `AppShell`:

**State shape (in AppShell):**

```
type ActiveFilters = {
  geography: Set<string>
  platform: Set<string>
  sector: Set<string>
  assetClass: Set<string>
}
```

**Data flow:**

```
AppShell (state owner)
  |-- UniversePane (receives: filteredHoldings, activeFilters)
  |-- ContextRail / AllocationLens (receives: allocation, activeFilters, toggleFilter, clearFilters)
  +-- WorkspaceCenter (receives: activeFilters -> passed to India/US/Returns)
```

**Filter application:**
- UniversePane: filters `holdings` array by active filters before passing to HoldingsTable
- IndiaView/USView: already filter by geography (hardcoded). Extend to respect `activeFilters`
- ReturnsScreen: filter bars already exist. Wire `activeFilters` to them.
- JourneyWorkspace: never filtered (per spec).

---

## 4. New tokens / CSS needed

No new design tokens are required. All values use existing tokens from `index.css`
and `tokens.json`. However, the following CSS utility classes are needed:

| Class | Purpose |
|---|---|
| `.collapsed` | Sidebar collapse animation: `width: 0; overflow: hidden; opacity: 0; pointer-events: none; transition: width var(--duration-base) var(--ease-out), opacity var(--duration-fast);` |
| No new `@theme` entries | The `panel` token from tokens.json is NOT wired yet -- use `bg-sidebar` instead |

The `panel` token in `tokens.json` (both light and dark) is defined but was never
added to `index.css` `:root` / `.dark`. This spec does NOT add it. If a future
iteration wants sidebar/center visual differentiation, add:

```
:root { --panel: oklch(0.955 0.005 285); }
.dark { --panel: oklch(0.15 0.007 285); }
```

And map it in `@theme inline`:
```
--color-panel: var(--panel);
```

---

## 5. What NOT to change

| Element | Why it is out of scope |
|---|---|
| `contract.ts` | Immutable. The sidebars consume the same JSON shapes. |
| `data.ts` hooks | Already provide `useLatest()`, `useHistory()`, `useAlerts()`, `usePerformance()`. No changes needed. |
| Center pane (WorkspaceCenter) | Out of scope. Only the filter prop wiring changes (section 3). |
| `AllocationDonuts` component | Used as-is for the Overview tab. The sidebar gets a variant or wrapper, not a rewrite. |
| `HoldingsTable` component | Used as-is with a new `variant="sidebar"` prop. Core table logic untouched. |
| HealthTicker footer | Stays as-is. ContextRail staleness section complements it (actionable only), does not duplicate. |
| ChatDrawer | Unaffected. |
| Bridge API | Unaffected. |

---

## 6. Implementation order

| Step | Files | Effort |
|---|---|---|
| 1. Add `.collapsed` CSS class to `index.css` | `index.css` | S |
| 2. Add `variant="sidebar"` to `HoldingsTable` | `HoldingsTable.tsx` | M |
| 3. Rewrite UniversePane to use HoldingsTable | `UniversePane.tsx` | M |
| 4. Add FilterBar pills to UniversePane | `UniversePane.tsx` | S |
| 5. Lift collapse state to AppShell | `AppShell.tsx`, `UniversePane.tsx` | S |
| 6. Create `MiniDonut` wrapper or add variant to AllocationDonuts | `AllocationDonuts.tsx` or new `MiniDonut.tsx` | M |
| 7. Rewrite ContextRail allocation section | `ContextRail.tsx`, `AllocationLens.tsx` | M |
| 8. Add alerts section to ContextRail | `ContextRail.tsx` | S |
| 9. Fix movers to use performance.json | `ContextRail.tsx` | S |
| 10. Fix staleness useMemo | `ContextRail.tsx` | S |
| 11. Lift filter state to AppShell, wire cross-filter | `AppShell.tsx`, `UniversePane.tsx`, `ContextRail.tsx` | M |
| 12. Mobile overlay / bottom sheet | `AppShell.tsx`, `UniversePane.tsx`, `ContextRail.tsx` | L |
| 13. Keyboard shortcuts (Ctrl+[, /) | `AppShell.tsx`, `UniversePane.tsx` | S |

**Total estimated effort:** ~2-3 evenings (M = medium ~1hr, S = small ~30min, L = large ~2hr).

---

## 7. Verification checklist

- [ ] `.collapsed` class works: toggle animates pane width 256px <-> 0px
- [ ] UniversePane renders via HoldingsTable: sorting works, keyboard nav works, sparklines hidden
- [ ] FilterBar pills toggle and combine with search
- [ ] ContextRail shows a real 64px EChart donut (not legend dots)
- [ ] Donut slice click sets a filter that propagates to UniversePane
- [ ] ContextRail shows alerts from `useAlerts()` (currently not called)
- [ ] ContextRail movers use `performance.json` topMovers (not `history.json` date changes)
- [ ] Staleness recomputes on data change (not frozen at render time)
- [ ] Dead classes removed: `aria-selected` as className, `data-[state=selected]`, `data-[state=active]`
- [ ] Mobile: UniversePane is a slide-in overlay, ContextRail is a bottom sheet
- [ ] Keyboard: Ctrl+[ toggles sidebar, / focuses search, arrows navigate tabs
- [ ] Cross-filter: donut click -> UniversePane filtered, India/US/Returns filtered, Journey untouched
- [ ] `npm run build` clean, `npm run typecheck` clean, `npm run lint` clean
- [ ] `npm run check:contract` still passes (no contract changes)
- [ ] `uv run ruff check .` + `uv run pytest` still pass (no Python changes)
