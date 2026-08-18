# Round 2 — Direction 2: "Portfolio OS"

**Date:** 2026-08-18 · **Author:** ui-designer (orchestrator-written) · **Tagline:** *One workspace. Every number. Zero navigation.*

---

## 1. Concept

The user asked for "a single place to track my portfolio" — so build a **single
workspace**, not a page of tabs. Portfolio OS is a data-dense, desktop-grade
financial terminal: a **three-pane master layout** where the left pane is always
the holdings universe, the center is the detail work area, and the right is
context (allocation / alerts / chat). There is no "home screen" to land on —
you land *in the data*.

Think **Bloomberg's four-pane discipline meets Linear's density**: every view is a
*variant* of one workspace rather than a separate destination. The header is a thin
command strip (⌘K-first); the footer is the live data-health ticker. Light and dark
themes are both first-class.

**The user-POV story:** *"I open it and I'm already somewhere useful. Left: every
holding I own, sorted by whatever I want. Center: the one I care about, with its
whole story — position, sparkline, return, trades, alerts. Right: what it does to
my allocation. I never 'go to a tab'. The data reorganizes itself around my
selection."*

---

## 2. Creative portfolio-tracking concepts

| Concept | What it is | User-POV value |
|---|---|---|
| **Master-detail holdings universe** | Left pane = the full 69-holding table, always visible, sortable/filterable/searchable. Selecting a row drives the center + right panes. | Zero navigation to answer "tell me about X" |
| **Holding dossier** | Center pane becomes a per-holding deep-dive: position card (qty/avg/current/P&L/day P&L), 7-day trend sparkline (platform series — contract-honest), return vs cost, recent trades, linked alerts, platform freshness. | The story of one position, in one place |
| **Live allocation context** | Right pane: geography/platform/sector/asset-class donuts that **cross-filter** — select "India" and the whole workspace filters; the donuts are the filter UI. | Allocation stops being a static report and becomes a lens |
| **Command-palette workspace switching** | ⌘K doesn't just search — it switches workspace *modes* (Universe / Returns / Alerts / Properties) and runs actions (refresh, theme, export). | Everything reachable in 2 keystrokes |
| **Attention rail** | Right-pane bottom: a stacked "attention" list — fired alerts, stale platforms, session expiries, biggest single-day moves. Red = act, amber = watch. | The must-do list is always in frame |
| **Live health ticker footer** | Scrolling/compact footer: per-platform freshness + FX + NAV + runs status — the machine's pulse, always visible. | Operational trust without opening a runs page |

**NOT included:** candlestick/price panes (no per-holding price history in the
contract — honest fallback: platform sparkline), multi-window floating panels
(complexity > value for a personal tool).

---

## 3. Look & feel — global chrome

### Header (40px — thin command strip)
```
┌──────────────────────────────────────────────────────────────────────┐
│ ◈  [ ⌘K  Search or switch workspace… ]     ☀/🌙   ⬇Refresh  ⬡Chat  👁 │
└──────────────────────────────────────────────────────────────────────┘
```
Extremely thin. The command bar is the primary control; everything else is a
one-click icon. Brand mark shrinks to the tile.

### Three-pane shell (desktop)
```
┌────────────────────────┬──────────────────────────────┬─────────────────────┐
│ HOLDINGS (universe)    │ DETAIL (dossier / table /    │ CONTEXT             │
│                        │         screen content)      │  allocation donuts  │
│  search  [filter]      │                              │  (cross-filter)     │
│ ┌────────────────────┐ │                              │  ┌───────────────┐  │
│ │ KPITTECH  +3.1% ▸  │ │  (selected holding dossier  │  │ geo / sector  │  │
│ │ SMH       -1.2% ▸  │ │   or the full-screen table  │  │  donuts       │  │
│ │ NIFTY MF  +0.4% ▸  │ │   when nothing is selected) │  └───────────────┘  │
│ │ … (69 rows)        │ │                              │  ┌───────────────┐  │
│ └────────────────────┘ │                              │  │ ATTENTION     │  │
│  sort: value ▲         │                              │  │ 2 alerts      │  │
│                        │                              │  │ moomoo stale  │  │
└────────────────────────┴──────────────────────────────┴─────────────────────┘
│ as-of · zerodha ✓ · moomoo ✓ · groww ✓ · FX USD/INR 84.2 · NAV 21 · runs ok │
└──────────────────────────────────────────────────────────────────────────────┘
```
- **Left pane** (`~320px`, resizable): the universe table — ticker, name, value,
  day P&L %, sparkline. Selecting a row = center pane switches to its dossier.
- **Center pane**: the "workspace" — by default the selected holding's dossier; a
  *workspace switcher* (⌘1..5) flips it to full-screen India/US/Returns/Alerts/
  Properties views (the old tabs, now modes of the center pane).
- **Right pane** (`~280px`, collapsible): allocation donuts (cross-filter) +
  attention rail.
- **Footer**: the live health ticker.

### Mobile (≤768px)
Panes stack: universe → detail → context become a drill-down (list → dossier →
donuts), with a bottom action bar. The master-detail magic survives as
list-select-then-detail.

### What happens to the 6 tabs
They become **center-pane workspace modes**, switchable via ⌘K, ⌘1..⌘6 shortcuts, or
a slim segmented control at the center-pane top. The left rail is gone — the
universe pane *is* the primary navigation.

---

## 4. Dark AND light theme

Identical mechanism to Direction 1 (data-theme + `.dark`, persisted,
prefers-color-scheme default). Token sets:

### Light
| Token | Value | Note |
|---|---|---|
| `--background` | `oklch(0.975 0.003 285)` | App background |
| `--card` | `oklch(1 0 0)` | Panes are white cards |
| `--panel` (new) | `oklch(0.955 0.005 285)` | Left/right pane tint, distinct from content cards |
| `--foreground` | `oklch(0.22 0.01 285)` | |
| `--muted-foreground` | `oklch(0.47 0.012 285)` | AA |
| `--primary` | `oklch(0.55 0.18 262)` | |
| `--gain` / `--loss` | `0.52 0.14 155` / `0.55 0.19 25` | AA on white |
| `--chart-1..9` | saturated-dark categoricals, AA on white | |

### Dark (audit-fixed, same as D1)
`--loss 0.70 0.17 25` (5.3:1), `--gain 0.74 0.14 155`, `--warning 0.82 0.13 85`,
`--muted-foreground 0.68`, plus a new `--panel` slightly lighter than background for
pane distinction (`oklch(0.15 0.007 285)`).

**Density is the theme's best friend here:** the OS layout ships
comfortable/compact density from round-1 spec (`data-density` on `<html>`), since a
3-pane workspace lives or dies on density.

---

## 5. Component inventory → shadcn/ui

| Need | shadcn primitive | Custom |
|---|---|---|
| Command strip | `command` (⌘K) | `CommandBar.tsx` + workspace switcher |
| Master-detail table | `table` + `scroll-area` | `UniversePane.tsx` (row selection, virtualized at 69 rows — fine without virtualization) |
| Dossier | `card` + `tabs` (internal tabs: P&L / Trades / Alerts) | `HoldingDossier.tsx` |
| Cross-filter donuts | `card` | `AllocationLens.tsx` (donuts as filters) |
| Attention rail | `badge`, `card` | `AttentionRail.tsx` |
| Theme toggle | `dropdown-menu` | `ThemeToggle.tsx` |
| Resizable panes | — | `ResizeHandle.tsx` (a11y: `role="separator"`, arrow keys) |
| Health ticker | `tooltip` | `HealthTicker.tsx` (footer) |
| Toasts | `sonner` | — |

**New primitives:** `command`, `dialog`, `dropdown-menu`, `sonner`, `table`,
`switch`, `avatar`. **Custom:** `CommandBar`, `UniversePane`, `HoldingDossier`,
`AllocationLens`, `AttentionRail`, `ResizeHandle`, `HealthTicker`, `ThemeToggle`.

---

## 6. Motion language

- **Pane selection:** center-pane content cross-fades 200ms; dossier sections
  stagger 40ms.
- **Cross-filter:** donut selection → table rows animate re-sort (CSS FLIP-ish via
  keyed re-render, 250ms) and donuts morph (ECharts built-in, 300ms).
- **Command bar:** 150ms scale+fade.
- **Attention rail:** new item slides in 250ms, red pulse on severity.
- **Refresh:** ticker numbers tick (delta counter 400ms); toast slide-up.
- **Reduced motion:** opacity-only, 0–150ms; no pulses.

---

## 7. Award-winning references

- **Bloomberg Terminal / Bloomberg Anywhere** — the four-pane discipline: data is
  always in frame, nothing hides behind a click.
- **Linear** — density, ⌘K, keyboard-first, calm dark theme; the model for the
  command strip + pane aesthetic.
- **Vercel / Turbopack dashboards** — the live health ticker footer and per-service
  status dots.
- **Notion** — master-detail with a persistent sidebar; resizable panes done well.
- **Robinhood / Groww** — the single-position dossier (what a retail investor
  actually reads about a holding).

---

## 8. Trade-offs & effort

| Trade-off | Honest assessment |
|---|---|
| 3-pane layout is a big change from tabs | Highest effort of the three directions; mobile needs a real collapse strategy. But it's the truest "single place" answer |
| Master-detail can feel cramped at 1024px | Right pane collapses by default below 1280px; left pane 260px minimum |
| Cross-filter donuts replace "reports" | Power users love it; casual users may find it dense — density toggle + collapse helps |
| Per-holding sparklines limited to platform series | Contract-honest fallback documented in the dossier |

**Effort:** shell + panes L · CommandBar L · UniversePane L · Dossier M · Lens M ·
Attention rail S · Ticker S · Theme system M. **Total: 3–4 sessions.**

---

## 9. User-POV statement

> "I'm a power user. I don't want a landing page — I want to open the app and
> already be inside my portfolio. Left is everything I own; I click a row and the
> whole middle becomes that holding's story, right is what it does to my mix. I
> filter by clicking a donut, I switch workspaces with ⌘2, I refresh with R, and the
> footer tells me if anything's stale before I even ask. It feels like my money has
> an operating system."