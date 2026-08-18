# Selected Direction — Hybrid 1+2: "Clarity + Density" (Polished. Dense. Fast.)

**Date:** 2026-08-18 · **Decision:** User selected **Hybrid: Direction 1 (Clarity First) + Direction 2 (Data Dense)**

---

## 1. What We're Building

A **polish + power** revamp of the M8 dashboard. We take the Clarity First foundation (token system, WCAG contrast fix, restrained information-carrying motion, density toggle, keyboard accessibility) and layer on the Data Dense power features (compact default density, in-row 7-day sparklines, multi-metric stat cards, global command bar, arrow-key table navigation).

**What we deliberately do NOT take from D3:** no Story view, no Spotlight rail, no IA restructuring (India/US stay separate tabs), no annotated narrative charts. The 6-tab structure, the JSON contract, and the determinism boundary are untouched.

---

## 2. Scope Summary

| Feature | Source | Effort |
|---|---|---|
| Design token system (color/spacing/radius/shadow/motion/density/typography) | D1 | M |
| `--loss` contrast fix (oklch 0.63 → 0.70 lightness) + 9-color chart palette | D1 | S |
| Density toggle (comfortable default / compact) persisted to localStorage | D1+D2 | M |
| Multi-metric stat cards (Net Worth / Day P&L / Return / XIRR as 2×2 mini-grids) | D2 | M |
| HoldingsTable: density-aware rows, keyboard-sortable headers, sticky header, `scope="col"` + `aria-sort`, column hover tint | D1 | M |
| HoldingsTable: in-row 7-day sparklines (IntersectionObserver + ECharts mini-line) | D2 | L |
| HoldingsTable: arrow-key row navigation (roving tabindex + `aria-activedescendant`) | D2 | M |
| Global CommandBar: `⌘K`/`/` fuzzy search of holdings/tabs/actions, `R` refresh, `?` help | D2 | L |
| TrendChart: dataZoom + range pills (1M/3M/6M/1Y/All) | D1 | M |
| FilterBar extracted (geography/asset-class pills, focus ring, `aria-pressed`) | D1 | S |
| Screen-aware skeletons (Overview: 4 cards + chart; tables: 10 rows) | D1 | S |
| Motion pass: entrance stagger, delta counters, cross-filter cross-fade, refresh toast | D1 | M |
| Donut a11y: hidden data table per donut | D1 | M |
| Chat drawer: `role="log"` + `aria-live="polite"`, spring thinking dots | D1 | S |
| Keyboard shortcuts: `/` search, `R` refresh, `?` shortcuts dialog | D1+D2 | S |
| Responsive: compact→comfortable auto-switch below 640px (touch targets) | D2 | M |

**Excluded (explicitly):** Story view, Spotlight rail, geo-toggle merge, annotated charts, chat-in-rail.

---

## 3. Design Principles (Borrowed)

1. **Quiet surfaces, loud data** (D1) — near-black bg, cards lift by border + soft shadow, only semantic colors (gain/loss/warning) + primary accent are saturated.
2. **Everything visible, nothing wasted** (D2) — compact is the *power* mode the user opts into; comfortable stays default so casual glances aren't cramped.
3. **Motion carries information** (D1) — every animation answers "what changed?"; nothing decorates.
4. **Keyboard is first-class** (D1+D2) — sortable headers, arrow-key rows, command bar, shortcuts. All focus-visible.
5. **Honest data** (project-wide) — `null` returnPct = "—", never "0%"; XIRR shows the "no captured trades yet" badge; stale badges visible.

---

## 4. Key Decisions Resolved

| Question | Decision |
|---|---|
| Default density? | **Comfortable** (D1 default) — opt into compact via toggle (D2 power). Auto-switch to comfortable <640px always. |
| Sparkline data source? | `history.json` `byPlatform[platform]` — the per-platform value series. Per-holding 7d is NOT in the contract (immutable) → sparkline shows **platform trend** with the holding's row highlighted. Honest: contract can't give per-ticker history yet. |
| Command bar scope? | Holdings (ticker/name/platform), tabs, actions (refresh, privacy, density, shortcuts). Read-only navigation + local actions — NEVER pipeline writes. |
| Refresh toast copy? | "Fresh data — pulled 35 Zerodha + 6 Moomoo positions" (from bridge summary). |
| Chart palette? | `--chart-1..9` CSS vars, and `CATEGORY_COLORS` in `options.ts` maps 1:1 (kills the audit §1 mismatch). |
| Motion library? | **No Framer Motion.** CSS keyframes + Tailwind `animate-*` + ECharts built-ins keep bundle at +~30KB total. |
| Bundle budget? | +50KB max. ECharts stays tree-shaken; sparklines reuse the same echarts core (no new chart lib). |

---

## 5. Files That Change

```
dashboard/src/index.css                      — tokens, density, motion, palette (MAJOR)
dashboard/src/lib/format.ts                  — maybe: compact currency helper for sparkline tooltips
dashboard/src/components/charts/options.ts   — 9-color palette mapping, dataZoom option builder
dashboard/src/components/layout/AppShell.tsx — density toggle, shortcuts, CommandBar mount
dashboard/src/components/layout/StatusBar.tsx— focus ring, aria-live toast
dashboard/src/components/layout/states.tsx   — screen-aware skeletons, ErrorState kinds, EmptyState action
dashboard/src/components/ui/card.tsx         — flat/raised/interactive variants
dashboard/src/components/overview/OverviewCards.tsx — multi-metric 2×2
dashboard/src/components/overview/TrendChart.tsx   — dataZoom + range pills
dashboard/src/components/overview/AllocationDonuts.tsx — hidden a11y tables
dashboard/src/components/holdings/HoldingsTable.tsx — sparklines, keyboard, density (MAJOR)
dashboard/src/components/returns/ReturnsScreen.tsx   — FilterBar extraction
dashboard/src/components/chat/ChatDrawer.tsx — role=log, aria-live, dots
dashboard/src/components/filter/FilterBar.tsx (NEW)
dashboard/src/components/command/CommandBar.tsx (NEW)
dashboard/src/components/command/shortcuts.ts (NEW)
dashboard/src/lib/density.ts (NEW)           — density provider + localStorage
dashboard/src/lib/useKeyboardShortcuts.ts (NEW)
dashboard/src/lib/sparkline.ts (NEW)         — mini ECharts option builder
dashboard/src/lib/useIntersectionObserver.ts (NEW)
```

**Contract files (`types/contract.ts`, `data.ts`) — UNTOUCHED.**

---

## 6. What's Next

1. Full spec package in `docs/design/spec/` (tokens.json + component/screen/motion/a11y specs).
2. Hand off to `dashboard-builder` for implementation (orchestrator delegates).
3. `code-reviewer` independent review at the end.
4. Verification: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run check:contract`, visual QA against the real JSON exports.