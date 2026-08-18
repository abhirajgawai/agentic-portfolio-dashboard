# Selected Direction — Hybrid 2+3: "The Journey OS"

**Date:** 2026-08-18 · **Decision:** User selected **Hybrid: Direction 2 (Portfolio OS) + Direction 3 (The Journey)**

---

## 1. What We're Building

A **three-pane financial workspace** (D2's shell) whose default center view is the
**Journey** — a narrated net-worth timeline with goal milestones and a milestone
journal (D3's heart). "Land in the story, work in the data."

```
┌─────────────────────────┬──────────────────────────────┬─────────────────────┐
│ UNIVERSE (left pane)    │ WORKSPACE CENTER             │ CONTEXT (right)     │
│  all 69 holdings,       │  Journey  ◈ (default home)   │  allocation donuts  │
│  always visible,        │  India · US · Returns ·      │  (cross-filter)     │
│  sortable/filterable,   │  Alerts · Properties ·       │  + ATTENTION rail   │
│  selecting a row →      │  Holding Dossier             │  (alerts/stale/     │
│  dossier in center      │  (when a row is selected)    │   session expiry)   │
└─────────────────────────┴──────────────────────────────┴─────────────────────┘
│ HEALTH TICKER (footer): as-of · zerodha ✓ · moomoo ✓ · groww ✓ · FX · NAV · runs │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**The user-POV story:** *"I open it and I land on my journey — the line of my net
worth through time, my goals as destinations. When I want to dig in, the left pane
holds everything I own; clicking any holding turns the whole center into its story.
Right is my allocation, which I can filter by just clicking a donut. ⌘K switches
workspaces, R refreshes, T themes. It's one workspace for my whole financial life."*

---

## 2. Scope Summary — what comes from where

| Feature | Source | Effort |
|---|---|---|
| **Three-pane shell** (Universe \| Workspace Center \| Context rail) | D2 | L |
| **Journey workspace** (default home) — narrated net-worth timeline, range pills, dataZoom, markLine/markPoint milestones | D3 | L |
| **Goal milestones on the journey line** (localStorage goals, progress chips, crossing card) | D3 | M |
| **Milestone journal** (auto-seeded from history deltas + events) | D3 | S |
| **Today panel** (day P&L in words, top mover, alerts) | D3 | S |
| **Account roads** (per-account mini-lines from history.byGeography/byPlatform) | D3 | S |
| **Year strip** ("2026 so far: X → Y, +Z%") | D3 | S |
| **Holding dossier** (center pane when a universe row is selected) | D2 | M |
| **Allocation lens** (donuts as cross-filter controls) | D2 | M |
| **Attention rail** (alerts / stale / session-expiry must-do list) | D2 | S |
| **Health ticker footer** (per-platform freshness, FX, NAV, runs) | D2 | S |
| **Command bar** (⌘K: workspace switch, holding search, actions; ⌘1..⌘6, R, T) | D1+D2 | L |
| **Light AND dark themes** (data-theme + .dark, OS default, persisted toggle) | user-mandated | M |
| **Density toggle** (comfortable default / compact opt-in, auto-comfortable <640px) | round-1 carryover | M |
| **HoldingsTable upgrades** (keyboard-sortable headers, arrow-key nav, in-row sparklines, sticky header) | round-1 carryover | L |
| **FilterBar** (geography/asset-class pills) | round-1 carryover | S |
| **Screen-aware skeletons + toast + a11y fixes** (incl. --loss 4.2:1 → 5.3:1) | round-1 carryover | M |

**Round-1 spec relationship:** the round-1 spec (`docs/design/spec/`) is
**superseded** by this round-2 spec. Its component-level polish (density, keyboard
table, sparklines, FilterBar, CommandBar, theme, a11y fixes, toasts, skeletons) is
absorbed into this spec and implemented ONCE, in the new shell. Round-1's spec.md
stays on disk as history only.

**Excluded (explicitly):** resizable floating panes (fixed panes with collapse are
simpler and sufficient), price candles (no per-holding history in the contract),
watchlist, social/sharing, LLM-generated insights (determinism boundary — all
narration is computed), confetti (calm by design).

---

## 3. Key Decisions Resolved

| Question | Decision |
|---|---|
| Default home? | **Journey workspace** in the center pane; left universe + right context always in frame |
| Where do the 6 tabs go? | Become **center-pane workspace modes**: Journey (new), India, US, Returns, Alerts, Properties. Switched via ⌘K, ⌘1..⌘6, or a slim segmented control at the center-pane top |
| Selecting a holding? | Universe row click → center pane becomes the **Holding Dossier**; a "back to workspace" affordance (breadcrumb/⌘0) returns to the previous workspace |
| Cross-filter scope? | Context donut selection filters the **universe + dossier + India/US/Returns workspaces**. Journey stays global (the story is never filtered) |
| Goals storage? | localStorage (contract-honest). A future contract field could make them durable |
| Sparklines? | Platform series from `history.byPlatform` (per-holding history is NOT in the contract — documented honest fallback) |
| Theme default? | `prefers-color-scheme` on first visit; toggle (☀️/🌙/Auto) persisted; keyboard `T` |
| Density default? | Comfortable; compact opt-in; auto-comfortable <640px |
| Motion? | CSS keyframes + ECharts built-ins ONLY. No Framer Motion. `prefers-reduced-motion` disables all animation |
| Bundle budget? | +50KB max over current (current ≈ 1,083KB raw / ~350KB gz) |
| Contract? | `dashboard/src/types/contract.ts` + `data.ts` **UNTOUCHED** |
| Real-estate leg? | Properties stays a workspace mode (existing PropertiesScreen re-homed into the center pane) |

---

## 4. Files That Change (dashboard/ only)

```
src/index.css                        — MAJOR: light+dark tokens, density, motion, 9-chart palette
src/components/layout/AppShell.tsx   — MAJOR: three-pane shell, header, theme wiring
src/components/layout/Header.tsx     — NEW: brand + ⌘K trigger + theme + refresh + chat + privacy
src/components/layout/HealthTicker.tsx — NEW (footer; supersedes StatusBar)
src/components/shell/UniversePane.tsx  — NEW: left holdings universe (search/filter/sort/select)
src/components/shell/WorkspaceCenter.tsx — NEW: workspace switch + dossier host
src/components/shell/ContextRail.tsx    — NEW: right allocation lens + attention rail
src/components/shell/AttentionRail.tsx  — NEW
src/components/shell/ResizeHandle.tsx   — NEW: a11y-friendly pane collapse toggles
src/components/workspaces/JourneyWorkspace.tsx — NEW: hero timeline + side cards
src/components/workspaces/JourneyChart.tsx      — NEW: ECharts area + markLine/markPoint + pills + dataZoom
src/components/workspaces/GoalMilestones.tsx    — NEW (localStorage goals)
src/components/workspaces/MilestoneJournal.tsx  — NEW
src/components/workspaces/TodayPanel.tsx        — NEW
src/components/workspaces/AccountRoads.tsx      — NEW
src/components/workspaces/YearStrip.tsx         — NEW
src/components/workspaces/HoldingDossier.tsx    — NEW (center detail for selected holding)
src/components/workspaces/AllocationLens.tsx    — NEW (donuts as filters)
src/components/command/CommandBar.tsx  — NEW (⌘K)
src/components/command/shortcuts.ts    — NEW
src/components/filter/FilterBar.tsx    — NEW
src/components/holdings/HoldingsTable.tsx — MAJOR: keyboard, density, sparklines, sticky
src/components/charts/options.ts       — 9-color palettes per theme + dataZoom builder
src/components/overview/TrendChart.tsx — superseded by JourneyChart (overview screen retired)
src/components/overview/OverviewCards.tsx — re-homed into Journey's TodayPanel (retired otherwise)
src/components/overview/OverviewScreen.tsx — RETIRED (Journey workspace replaces it)
src/components/layout/StatusBar.tsx    — RETIRED (HealthTicker supersedes)
src/components/layout/states.tsx       — skeletons/error/empty, screen-aware
src/components/ui/card.tsx             — flat/raised variants
src/components/chat/ChatDrawer.tsx     — a11y polish (role=log, aria-live), stays a drawer
src/lib/theme.ts (NEW) · src/lib/density.ts (NEW) · src/lib/useKeyboardShortcuts.ts (NEW)
src/lib/useIntersectionObserver.ts (NEW) · src/lib/sparkline.ts (NEW) · src/lib/goals.ts (NEW)
src/lib/workspaces.ts (NEW) · src/lib/format.ts (minor: compact currency for tooltips)
package.json                          — NEW shadcn primitives: command, dialog, dropdown-menu,
                                        sonner, progress, switch, avatar, table
```

**Contract files (`types/contract.ts`, `lib/data.ts`) — UNTOUCHED.**

---

## 5. What's Next

1. **Spec package** → `docs/design/spec-round2/` (spec.md + tokens.json + motion + a11y + rationale) — this doc is the brief's context.
2. **Hand off to `dashboard-builder`** (orchestrator delegates; spec is the authoritative brief).
3. **`code-reviewer`** independent review at the end (structure, a11y, determinism, guardrails).
4. **Verification:** `npm run build`, `npm run typecheck`, `npm run lint`, `npm run check:contract`, visual QA against the real JSON exports in both themes.