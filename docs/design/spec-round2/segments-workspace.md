# Spec Addendum — Segments Workspace (7th workspace mode)

**Status:** approved-direction addendum (Option A) · **Date:** 2026-08-20 ·
**Author:** ui-designer · **Audience:** `dashboard-builder` (implementation),
`code-reviewer` (gate), orchestrator (open questions §12).

**Read first:** `docs/design/spec-round2/spec.md` (authoritative brief — this
file **adds** one workspace to it, it does not modify or supersede anything),
`docs/design/spec-round2/tokens.json` (token system), `spec-round2/motion/`
and `spec-round2/accessibility/` (this file's §7 extends both).

---

## 0. Scope & hard constraints

- **Additive only.** One new workspace id `segments`, one new client module
  `src/lib/segments.ts`, three new components (`SegmentCard`,
  `SegmentReconcileBar`, `SegmentBreakdown`), one registry entry + one
  `WorkspaceCenter` branch. Nothing existing is modified beyond those seams.
- **Contract immutable** (`contract.ts`) — segments are **derived client-side
  only** from `latest.json` (+ `history.json` for the optional trend; the
  `performance.json` day-P&L cross-check is noted but optional). No new
  contract fields, no `data.ts` shape changes.
- **Determinism boundary intact** — every number is arithmetic on contract
  data; no LLM narration, no fabricated insights.
- **Stack/bundle locked** — no new dependencies; CSS keyframes + ECharts
  built-ins only (no Framer Motion); bundle delta target **+2–8KB** (well
  under the +50KB budget).
- **Both themes**, WCAG AA, `prefers-reduced-motion` disables all animation.

---

## 1. Placement

### 1.1 Registry order, tab, label, shortcut

Append `segments` as the **7th entry** of `WORKSPACES` in
`dashboard/src/lib/workspaces.ts` — i.e. after `properties`:

```
journey · allocation · holdings · returns · alerts · properties · segments
```

- **Tab label:** `Segments`.
- **Keyboard shortcut:** **⌘7** (Ctrl+7). `useKeyboardShortcuts` derives the
  ⌘1..⌘n range from the workspaces array length, so appending to the registry
  enables ⌘7 with **zero renumbering** of ⌘1..⌘6. Tab order, registry order
  and shortcut number are **coupled by design** (Header maps `WORKSPACES` →
  tabs; shortcuts map `WORKSPACES` → ⌘n) — see §12 open question if the user
  prefers a different position.
- **Icon:** `Layers` (lucide-react). Segments-as-layers is the cleanest
  metaphor (stacks of portfolio slices); alternatives rejected: `PieChart`
  (visually collides with the Allocation workspace), `Grid3X3` (generic).
  The registry gains an **optional `icon` field** consumed by the CommandBar
  (spec.md §3.8 builds its items from the registry); the Header segmented
  control stays **text-only** (current pattern) — no layout change.

### 1.2 How Segments interacts with UniversePane cross-filters

The answer is deliberately two-directional — **read (highlight)** and
**write (focus)** — and it keeps the Journey exception intact:

| Direction | Rule |
|---|---|
| **Read** | The Segments workspace **reads** `useFilters()` to *ring* the card that matches the active filter set (e.g. `geography:US` → US card gets an active ring). Card **numbers never change** — a card is the segment's full total, always. When filters are active but match no segment (e.g. a sector filter), a slim note shows: "Cross-filters active — segment cards always show full totals." |
| **Write** | Clicking a card **replaces the entire filter state** with that segment's membership (see §4.2). This is the drill-down: the UniversePane + AllocationLens + India/US/Returns workspaces then show exactly the segment. |
| **Never filtered** | Journey stays unfiltered (existing rule, untouched). Segments itself is **not shrunk by filters** — only highlighted. |

Rationale: if cards shrank under filters, "US is ₹22.1L" would stop being a
stable truth and the reconciliation strip (§5) would break visually. Segment
cards are *facts*; filters are *lenses* — the card rings to say "this lens is
this segment", never re-computes.

---

## 2. Segment data model (`src/lib/segments.ts`)

New client module, same pattern as `src/lib/returns.ts` (pure derivation +
`useMemo`). No contract changes.

### 2.1 Segment definitions

| id | label | Membership predicate (on `latest.holdings`) | Notes (must be surfaced) |
|---|---|---|---|
| `us` | US | `h.geography === 'US'` | 6 holdings, all moomoo; display currency **SGD** (only segment with a foreign display currency); live leg (2d threshold). |
| `india` | India | `h.geography === 'IN'` | 63 holdings: zerodha 36 + groww 20 + sharekhan 6 + real_estate 1; **includes real estate (₹35.0L, manually revalued)** — must be visible. Mixed freshness: live (zerodha 2d) + CAS (35d). |
| `groww_cas` | Groww-CAS | `h.platform === 'groww' \|\| h.platform === 'sharekhan'` | 26 holdings; **refreshed only by monthly CAS import + daily AMFI NAV** — the Refresh button never touches it; 35d threshold. |
| `consolidated` | Consolidated | `() => true` | All 69; the hero card. |

Overlap is intentional and **visible**: `groww_cas ⊂ india ⊂ consolidated`,
`us ⊂ consolidated`. The reconciliation strip (§5) makes the nesting legible.

### 2.2 Derivation formulas (per segment, client-side)

| Metric | Formula | Honesty rule |
|---|---|---|
| `valueBase` (₹) | `Σ h.valueBase` over members | Primary headline. |
| `valueDisplay` (SGD) | `Σ h.valueDisplay` over members — **only when all members share one displayCurrency** (true for US; null elsewhere) | Secondary line on US card: "≈ SGD 29.4k". |
| `dayPnlBase` (₹) | `Σ h.dayPnl × fx(h.currency)` for members with `h.dayPnl !== null`; `fx = latest.fx.USDINR` for USD, `1` for INR, skip unknown | **Live legs only** — CAS rows have `dayPnl = null`, so this naturally yields zerodha/moomoo-only day P&L. `null` when no member has a day P&L (Groww-CAS → "—"). For Consolidated prefer the pipeline-authoritative `latest.totals.dayPnl`; the sum equals it to rounding. |
| `dayPnlAccount` | US only: `latest.totals.dayPnlByAccountCurrency.SGD` | Sub-line "≈ +SGD 141.8" — the account-currency view, matches the broker view. |
| `simpleReturn` | `simpleReturn(holdings)` from `src/lib/returns.ts` → `{pct, withCost, noCost}` | Cost coverage always shown: "7 of 26 with cost basis". `pct === null` (no cost-bearing members) → "—". |
| `stale` | `members.some(p => latest.platforms[p]?.stale === true)` | Aggregate badge; tooltip breaks down per platform. |
| `asOf` | `latest.asOf` (export timestamp, consistent with HealthTicker) | Tooltip lists each member platform's `asOf` + threshold. |
| `platforms` | unique member platforms (sorted) | Breakdown input + India "incl. real estate" line. |
| `count` | member count | Card badge + header. |

### 2.3 Reference numbers (live export 2026-08-20 — illustrative only, the UI derives everything)

| Segment | Value (₹) | Display ccy | Day P&L | Return (cost coverage) |
|---|---|---|---|---|
| US | ₹22,10,112 | SGD 29,425 | +₹10,647 (≈ +SGD 141.8) | +16.1% (6/6) |
| India | ₹80,62,805 | — | +₹7,431 (zerodha leg) | +46.5% (43/63) |
| Groww-CAS | ₹28,32,730 | — | — (no live legs) | (7/26) |
| Consolidated | ₹1,02,72,917 | — | +₹18,078 | (49/69) |

> Note: the round-2 brief's "India ~₹53.9L" was from an earlier snapshot; the
> live export includes the ₹35.0L real-estate revaluation. **Never hardcode** —
> compute from the contract.

---

## 3. Card anatomy (`SegmentCard`)

### 3.1 Layout of the workspace

```
┌────────────────────────────────────────────────────────────────┐
│ h1 (sr-only) "Segments"                                        │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ CONSOLIDATED (featured, full-width hero card)              │ │
│ │ ₹1.02Cr · Day P&L +₹18.1k · +46.5% (49/69) · 69 holdings   │ │
│ └────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────┬──────────────────────────────────┐ │
│ │ US (default card)       │ India (default card)             │ │
│ │ ₹22.1L · ≈ SGD 29.4k    │ ₹80.6L · incl. real estate       │ │
│ │ Day +₹10.6k · +16.1%    │ Day +₹7.4k (zerodha) · +46.5%    │ │
│ │ 6 holdings · ● fresh    │ 63 holdings · ● fresh            │ │
│ ├─────────────────────────┼──────────────────────────────────┤ │
│ │ Groww-CAS (default)     │ (empty slot — grid reserves      │ │
│ │ ₹28.3L · Day — (CAS)    │  3-across rhythm)                │ │
│ │ 26 holdings · ● fresh   │                                  │ │
│ └─────────────────────────┴──────────────────────────────────┘ │
│ SegmentReconcileBar (below grid, full width)                   │
│   US ₹22.1L + India ₹80.6L = ₹1.02Cr ✓                        │
│   Groww ₹27.9L + Sharekhan ₹0.4L = ₹28.3L ✓                   │
└────────────────────────────────────────────────────────────────┘
```

Desktop: hero (Consolidated) full-width on top, then a 3-column row
(US · India · Groww-CAS). Responsive rules in §9.

### 3.2 Slot table

| Slot | Required | Description |
|---|---|---|
| `root` | yes | Interactive card. Variants: `featured` (Consolidated — larger padding, `--primary`/`--ring` accent border) / `default`. States: default / hover / focus / active-ring / loading / stale / masked. Whole card is **one** button-like element (no nested interactive). |
| `header` | yes | Icon (`Layers` glyph per segment or a per-segment icon) + segment label + count badge ("63") + chevron affordance (appears on hover/focus, `ChevronRight`). |
| `value` | yes | Headline `valueBase` (₹ compact, `text-2xl`, `tabular-nums`, delta-counter on refresh). Sub-line: US → "≈ SGD 29.4k" (`text-xs muted-foreground`); India → "incl. real estate ₹35.0L"; CAS → "CAS import + AMFI NAV" (honest source line); Consolidated → "all platforms". |
| `pnl` | yes | "Day P&L" row: `+₹10.6k` in `--gain`/`--loss`, `tabular-nums`. `null` (CAS) → "—" + note "CAS re-prices monthly" (tooltip). Signed compact format. |
| `return` | yes | "Simple return" row: `+46.5%` (`formatPct`, 1dp) + coverage sub-note "43 of 63 with cost basis". `null` → "—" + "no cost basis". Never hide 20/69 null-return reality. |
| `meta` | yes | Staleness badge (amber `--warning` pill "stale" + tooltip per platform) **or** fresh dot (`--gain`); then "As of 20 Aug 09:52 IST" (`text-xs muted-foreground`, tooltip = per-platform asOf). |
| `footer` | no | **Optional (phase 2):** 7-day segment trend sparkline. Data = sum of member platforms' `history.byPlatform[p]` arrays (all 5 keys exist today: groww, moomoo, real_estate, sharekhan, zerodha; missing key → zeros). Honest label: "segment trend — sum of platform series" (tooltip). Reuses `src/lib/sparkline.ts` + IntersectionObserver. **Not required for the card to be complete.** |

### 3.3 Per-card content map

| Card | value sub-line | pnl | return | meta notes |
|---|---|---|---|---|
| US | "≈ SGD 29.4k" | +₹10.6k, sub-line "≈ +SGD 141.8" | +16.1% · "6 of 6 with cost basis" | moomoo 2d threshold |
| India | "incl. real estate ₹35.0L" | +₹7.4k, tooltip "live legs only — zerodha" | +46.5% · "43 of 63 with cost basis" | mixed thresholds visible |
| Groww-CAS | "CAS import + AMFI NAV" | "—" (tooltip "CAS re-prices on monthly import — never a one-day move") | coverage note "7 of 26 with cost basis" | 35d threshold; "Refresh button never touches this leg" tooltip |
| Consolidated | "all platforms" | `latest.totals.dayPnl` | +46.5% · "49 of 69 with cost basis" | `latest.asOf` |

### 3.4 Variants / states (card level)

| State | Trigger | Visual | Motion |
|---|---|---|---|
| default | — | Base card, `--shadow-xs` | — |
| hover | Mouse enter | `--shadow-md` + 2px up | 150ms `--ease-out` |
| focus | Keyboard | `--shadow-focus` ring | 100ms |
| active-ring | Filter set matches this segment (`useFilters`) | `--ring`-tinted border + `aria-pressed` | 200ms |
| loading | Queries loading | Skeleton card (`--muted` shimmer block) | pulse 1.5s (reduced-motion: static) |
| stale | Any member `platforms[p].stale` | Amber `--warning` badge | badge pulse 300ms once on mount/refresh |
| masked | Privacy on | `MASK_TEXT` on all money; pct/counts stay | cross-fade 200ms |
| empty | Segment has 0 members | Value "—", note "No holdings in this segment" | fade 300ms |

---

## 4. Drill-down (`SegmentBreakdown`)

### 4.1 Interaction map

| User action | Component | Response | Navigation |
|---|---|---|---|
| Click a card (mouse/Enter/Space) | `SegmentCard` | 1) **write** the cross-filter to the segment membership (§4.2); 2) open `SegmentBreakdown` in the center pane with that segment | Breadcrumb `← Segments / US`; focus moves to the breadcrumb (dossier pattern) |
| Back (breadcrumb `←` or `Esc`) | `SegmentBreakdown` | Return to the card grid; **filters stay** (honest — the universe keeps showing the segment; the user clears via the breakdown's clear button or AllocationLens) | previous view |
| "Clear segment filter" (shown when filters active) | `SegmentBreakdown` | `clearFilters()` — universe returns to full; breakdown itself is unaffected | — |
| Click a platform row | `SegmentBreakdown` | Set `platform` filter to that platform (replace-all of the platform dimension) — same lens semantics as AllocationLens | UniversePane updates; breakdown stays |
| Click a holding row | `SegmentBreakdown` (`HoldingsTable`) | Open the existing `HoldingDossier` | Dossier in center; breadcrumb becomes `Segments / US / SMH` |

### 4.2 Filter-write semantics (card click)

Clicking a card **replaces the entire filter state** with the segment's
membership (not additive):

- US → `geography = {US}`, all other dimensions cleared.
- India → `geography = {IN}`, all other dimensions cleared.
- Groww-CAS → `platform = {groww, sharekhan}`, all other dimensions cleared.
- Consolidated → `clearFilters()`.

This gives the simplest mental model: *"click a segment → everywhere now shows
that segment."* The universe table then shows exactly the breakdown table's
rows, so the cross-filter and the drill-down can never contradict each other.
The AllocationLens "Clear filters" control and the breakdown's own clear
button are the escape hatches.

### 4.3 Breakdown anatomy

```
Breadcrumb:  ← Segments / US
Header:      US segment — 6 holdings · ₹22.1L · Day +₹10.6k · +16.1% (6/6 with cost)
             [Clear segment filter]
Platform summary (per segment member platform):
  Platform | Holdings | Value (₹) | % of segment | Return* | Day P&L | asOf       | Freshness
  moomoo   | 6        | ₹22.1L    | 100%         | +16.1%  | +₹10.6k | 20 Aug 09:52 IST | ● fresh
HoldingsTable: full table of segment holdings (reuse — keyboard-sortable
  headers, arrow-key rows, in-row sparklines, sticky header, density-aware).
Honesty footnotes (fixed, data-driven):
  • "Day P&L covers live legs only (zerodha/moomoo). CAS rows re-price on
    monthly import — never a one-day move."
  • "Return covers N of M holdings with cost basis (CAS value-only rows are
    excluded from return math)."
  • Groww-CAS segment only: "Refreshed by monthly CAS import + daily AMFI NAV —
    the Refresh button never touches this leg."
  • India segment only: "Includes real estate (₹35.0L) — manually revalued."
```

- The breakdown table uses **segment membership directly** (not the context
  filter), so it stays correct even if the user clears filters afterward.
- `% of segment` = `valueBase(platform) / valueBase(segment) × 100`, 1dp.
- Optional (v1 can skip): a "broker-reported" cross-check per live platform
  from `performance.daily[last].brokerDayPnl` (keys moomoo/zerodha only —
  confirms live-legs-only), labeled with its own date, since the performance
  ledger can lag the live export (the known 08-18 dayPnlBase=0 artifact).

---

## 5. Reconciliation invariant (`SegmentReconcileBar`)

A full-width strip **below the card grid** (above any breakdown). It makes
both identities **visibly true** — the brief's requirement.

```
┌──────────────────────────────────────────────────────────────────┐
│ US ₹22.1L  +  India ₹80.6L  =  ₹1.02Cr   ✓ sums match            │
│ Groww ₹27.9L  +  Sharekhan ₹0.4L  =  ₹28.3L   ✓ sums match       │
└──────────────────────────────────────────────────────────────────┘
```

- **Identity 1:** `Σ us.valueBase + Σ india.valueBase === Σ consolidated.valueBase`
  (geography partition of the same holdings array — holds exactly by
  construction; verified live: 22,10,112.03 + 80,62,804.64 = 1,02,72,916.67).
- **Identity 2:** `Σ groww.valueBase + Σ sharekhan.valueBase === Σ groww_cas.valueBase`
  (definitional — groww_cas is the union).
- **Check:** each side is computed independently from the same `latest.holdings`
  array; equality is asserted with `Math.abs(a − b) < 1` (INR rounding
  epsilon). Match → `✓ sums match` (text, not icon-only; `role="img"` alt
  text). Mismatch (theoretically impossible with one data source) → amber
  `--warning` line "differs by ₹X" — never silently resolved.
- **Footnote tooltip:** "Segments are derived client-side from the latest
  export — identities hold exactly. Day P&L covers live legs only; CAS legs
  re-price on monthly import."
- `role="status"` + `aria-live="polite"` — announced once on workspace mount
  and once per refresh (debounced final value, per a11y-spec §5).

---

## 6. Tokens & design-system slots

### 6.1 No new tokens

**Zero new color tokens, zero new structural tokens.** The addendum reuses the
existing `tokens.json` system (both themes). Token usage map:

| Use | Tokens |
|---|---|
| Card surface | `--card`, `--card-foreground`, `--border`, `--shadow-xs/md` |
| Featured (Consolidated) accent | `--primary` border-left/accent + `--ring` tint — no new color |
| Day P&L | `--gain` / `--loss` (AA-tuned in both themes) |
| Stale badge | `--warning` + `--warning/15` bg (HealthTicker pattern) |
| Muted copy / asOf | `--muted-foreground`, `--text-2xs/xs` |
| Headline value | `--text-2xl`, `--text-md` labels, `font-variant-numeric: tabular-nums` (global number rule) |
| Focus ring | `--shadow-focus` |
| Active-ring | `--ring` + `--shadow-focus` |
| Density | `--row-*` (breakdown `HoldingsTable` already density-aware) |
| Motion | `--duration-fast/base/slow`, `--ease-out/in-out` |

If per-segment color coding is ever wanted, use the existing `--chart-1..9`
categoricals mapped deterministically (e.g. US → `--chart-6`, India →
`--chart-1`, CAS → `--chart-3`, Consolidated → `--primary`) — no new tokens.

### 6.2 Component-slot additions to the design system

Three new slots (documented here, matching the skill's component-spec
structure: anatomy, variants, states, props, a11y, motion, implementation):

1. **`segment-card`** — the card in §3. Props:
   `{ segment: SegmentMetrics; variant: 'featured'|'default'; active: boolean;
   masked: boolean; onOpen: () => void }`. Whole-card button; no nested
   interactive children.
2. **`segment-reconcile-bar`** — the strip in §5. Props:
   `{ identities: {label: string; sum: number; target: number}[] }`. Renders
   ✓/⚠ per identity; `role="status"`.
3. **`segment-breakdown`** — the drill-down in §4. Composes existing
   primitives: `HoldingsTable`, `Badge`, `Card`, breadcrumb (dossier pattern),
   `Button` (clear filter). No new primitives.

Implementation primitives: shadcn/ui `Card`, `Badge`, `Button`, `Tooltip`,
`Skeleton` — all already in the tree. Icons: lucide `Layers`, `Globe2`,
`MapPin`, `Landmark`, `ChevronRight`, `Check`, `AlertTriangle`.

---

## 7. Motion & a11y

### 7.1 Motion spec (extends `spec-round2/motion/motion-spec.md`)

| Trigger | Animation | Timing | Reduced motion |
|---|---|---|---|
| Workspace mount (entrance) | Hero card first, then 3 cards — fade + 6px rise, stagger 60ms per card | ≤ 480ms total, `--ease-out` | instant, no stagger |
| Refresh (data update) | Value + day-P&L delta counters; reconcile strip re-check fades | counter 400ms, strip 400ms opacity-only | instant (final values only) |
| Stale badge | Pulse once on mount/refresh | 300ms | no pulse |
| Card hover | `--shadow-md` + 2px up | 150ms `--ease-out` | none |
| Card press | scale 0.98 | 100ms | none |
| Card → breakdown | Keyed content re-render fade (center container) + breadcrumb fade | 150ms | instant |
| Cross-filter write | Existing AllocationLens slice dim/highlight + universe keyed re-render | 200ms / 250ms (existing motion-spec §4) | instant |
| Active-ring on matching card | Ring/border fade | 200ms | instant |

**Budget check:** entrance < 800ms ✓ (480ms) · refresh < 600ms ✓ (400ms) ·
interaction < 150ms ✓ (hover 150, press 100, drill 150) · reduced-motion
instant ✓. Only `transform`/`opacity`/`box-shadow` animated (GPU-friendly);
no layout-shifting properties.

### 7.2 A11y (extends `spec-round2/accessibility/a11y-spec.md`)

- **Structure:** one sr-only `<h1>` "Segments" per workspace rule; card titles
  `<h3>` inside the card button (title is text content, not a separate focus
  stop); reconcile strip is a `<ul>` of identity lines.
- **Interactive cards:** the whole card is one button —
  `aria-label="US segment — 6 holdings, value 22.1 lakh rupees — open
  breakdown"`; `aria-pressed` on the active-ring state; `--shadow-focus` ring
  visible in both themes.
- **Staleness badge:** text + `aria-label` "Groww-CAS stale — groww 35 days
  past threshold, sharekhan 34 days" (per-platform breakdown in tooltip).
- **Live regions:** one `role="status"` `aria-live="polite"` container on the
  Segments workspace announcing refresh results ("Segments updated — US plus
  India equals Consolidated ✓") — **final state only**, debounced (no
  mid-tick chatter per a11y-spec §5). Reconcile strip itself is
  `role="status"`.
- **Focus order:** Header workspace tabs → card grid (left→right, hero first
  in DOM) → reconcile strip (skip link makes it optional) → ContextRail.
  Opening a breakdown moves focus to the breadcrumb `←` (dossier pattern);
  `Esc` returns to the grid; focus never lost on refresh.
- **Keyboard:** cards Tab-reachable, Enter/Space activates; breakdown table
  reuses the HoldingsTable keyboard model (sortable headers, arrow-key rows).
  No new shortcuts beyond ⌘7.
- **Contrast:** all text uses AA-tuned tokens (`--gain`/`--loss`/`--warning`/
  `--muted-foreground` verified in both themes by a11y-spec §1); the
  "—" null states use `--muted-foreground` at ≥4.5:1.
- **SR never chart-only:** optional sparkline footer has a hidden text
  summary (first/last value of the 7-day window) or is omitted for SR —
  chart is decoration, data is text.

---

## 8. States table (workspace + card)

| Screen state | Condition | Workspace rendering | Card rendering |
|---|---|---|---|
| Loading | `useLatest`/`useHistory` loading | 4 skeleton cards (hero + 3) staggered | Skeleton slots, `--muted` shimmer |
| Error | Query error | `ErrorState` with retry (existing `states.tsx`) | — |
| Empty | 0 holdings total (fresh DB, `asOf: null`) | `EmptyState` — "Run the pipeline or Refresh to populate segments" | — |
| Partial | Segment with 0 members | Other cards render normally; that card shows "No holdings in this segment" | Value "—", no pnl/return |
| Stale | Any member `platforms[p].stale` | — | Amber badge + tooltip; never blocks interaction |
| Masked | Privacy on | All money `MASK_TEXT`; pct/counts/asOf stay | Cross-fade 200ms |
| No cost basis | Segment has 0 cost-bearing members | Return row "—" + "no cost basis" | — |
| No live legs | Segment has no live platforms (Groww-CAS) | Day P&L "—" + tooltip "CAS re-prices monthly" | — |
| Partial (trend) | `history.byPlatform` missing a member key | Footer sparkline omitted for that segment + honest note (optional slot) | — |

---

## 9. Responsive behavior

| Breakpoint | Layout |
|---|---|
| **≤640 (mobile)** | Hero + 3 cards stack full-width (touch targets far above 44px — whole-card buttons). Reconcile strip stacks to 2 lines. Breakdown: header condenses, platform summary + table horizontal-scroll (existing table pattern), bottom action bar from the shell remains. |
| **641–1024 (tablet)** | Consolidated spans full width; US/India/Groww-CAS: 3-across at ≥900px, else 2-col with Groww-CAS wrapping (or spanning — builder's choice, keep DOM order). Strip 2-col. |
| **>1024 (desktop)** | Hero full-width + 3-across row. Strip single line with dividers. 3-pane shell unchanged (UniversePane | WorkspaceCenter | ContextRail). |

Density: cards use `--spacing-*` so `data-density="compact"` tightens padding
(`--spacing-4` → `--spacing-3` on value/pnl rows); breakdown table already
density-aware via `--row-*`.

---

## 10. Performance & implementation notes

- **Bundle:** new code ≈ `segments.ts` (pure, ~60 lines) + `SegmentCard` +
  `SegmentReconcileBar` + `SegmentBreakdown` — estimate **+2–8KB gzip**, well
  under the +50KB budget. No new deps; ECharts modular imports unchanged
  (optional sparkline footer reuses the existing sparkline builder).
- **No new queries:** reuses `useLatest()` / `useHistory()` / `useFilters()`
  — no extra fetches, no contract validation changes (`check:contract`
  untouched).
- **Implementation order for `dashboard-builder`:**
  1. Registry: append `{ id: 'segments', label: 'Segments', icon: Layers }`
     (+ optional `icon` field in the type) → ⌘7 works automatically.
  2. `src/lib/segments.ts` — definitions + derivation (§2).
  3. `SegmentCard` grid + `SegmentReconcileBar` (§3, §5).
  4. `SegmentBreakdown` + filter-write + breadcrumb (§4).
  5. `WorkspaceCenter` branch `workspace === 'segments'`; wire
     `setTransientDossier` for the breakdown's dossier hop.
  6. Motion + a11y pass (§7) + reduced-motion audit.
- **Verification additions (to spec.md §7):**
  - Reconcile strip shows `✓ sums match` on both identities with live data
    (exact equality, epsilon < ₹1).
  - Card values agree with the header/HealthTicker numbers
    (US 22.10L / India 80.63L / CAS 28.33L / total 1.02Cr).
  - Groww-CAS card shows day P&L "—"; US card shows the SGD secondary.
  - ⌘7 switches to Segments; Esc returns from breakdown; focus lands on
    breadcrumb.
  - Masked mode hides money on cards/breakdown; pct/counts remain.
  - `prefers-reduced-motion: reduce` → zero animation, everything reachable.
  - AA spot-check `--gain`/`--loss`/`--warning` on card surfaces, both themes.

---

## 11. Design review checklist (self-check)

- ✅ **Contract compliance** — no new fields; all data read from `latest` /
  `history` / `performance` via existing schemas; `data.ts` untouched.
- ✅ **Token completeness** — no hardcoded colors/spacing; every visual
  references `tokens.json` (§6.1).
- ✅ **State coverage** — loading/empty/error/partial/stale/masked/no-cost/
  no-live all specified (§8).
- ✅ **Motion budget** — entrance 480ms < 800ms; refresh 400ms < 600ms;
  interaction ≤ 150ms; reduced-motion instant (§7.1).
- ✅ **A11y baseline** — AA in both themes, focus ring, whole-card button
  semantics, live regions, sr-only h1, focus order (§7.2).
- ✅ **Responsive** — ≤640 / 641–1024 / >1024 specified (§9).
- ✅ **Performance** — no new deps, +2–8KB, reuses existing queries/ECharts.
- ✅ **Guardrails** — determinism intact (pure derivation); shadcn primitives
  only; Tailwind v4 tokens; no Framer Motion; ⌘7 registry append only.

---

## 12. Open questions for the orchestrator (resolve before build)

1. **Tab position vs shortcut.** This spec appends `segments` as the **7th
   workspace (after Properties, ⌘7)** — honoring the brief's "⌘7" and avoiding
   renumbering. If the user prefers it next to Allocation (position 3, the
   "split views" cluster), the consequence is a **renumber**: Holdings ⌘4,
   Returns ⌘5, Alerts ⌘6, Properties ⌘7, Segments ⌘3. **Recommendation:
   keep ⌘7 append-last.** Confirm.
2. **Card-click filter semantics.** Spec uses **replace-all** (click US →
   universe shows exactly US, other filters cleared). Alternative: additive
   (US ∩ existing sector filter). Recommend replace-all. Confirm.
3. **Day-P&L source.** Card uses the **live-leg per-holding sum from
   latest.json** (freshest, equals the header's Day P&L); performance.json
   `brokerDayPnl` stays an optional cross-check in the breakdown (it can lag —
   the known 08-18 `dayPnlBase=0` artifact). Confirm no preference for
   performance-ledger-first.
4. **Brief data drift (honest flag).** The round-2 brief's "India ~₹53.9L"
   predates the real-estate leg revaluation; the live export shows ₹80.63L
   (incl. ₹35.0L real estate). The spec derives everything client-side, so no
   action needed — flagging so nobody "matches" a stale number during QA.
5. **Optional trend footer.** §3.2's sparkline footer is phase-2. Build now
   (small, reuses sparkline.ts) or defer? Recommend defer — the cards are
   complete without it.
6. **Holdings workspace interplay.** Card-click filters UniversePane +
   AllocationLens + India/US/Returns (spec 3.7 list). The **Holdings
   workspace itself shows all holdings** (it is not on the filter list in the
   authoritative brief). Clicking a card then visiting Holdings shows 69 rows
   while the universe shows the segment — acceptable today, but note it; a
   future option is adding Holdings to filter-opted workspaces.
