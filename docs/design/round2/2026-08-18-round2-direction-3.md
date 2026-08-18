# Round 2 — Direction 3: "The Journey"

**Date:** 2026-08-18 · **Author:** ui-designer (orchestrator-written) · **Tagline:** *Track the life your money is building.*

---

## 1. Concept

People don't track a portfolio for the charts — they track it because they're
**building a life**: a house, retirement, an emergency cushion, freedom. The
Journey makes that visible. The home screen is a **net-worth journey timeline** —
a single sweeping line from your first recorded snapshot to today, annotated with
the events that shaped it (first trade captured, MF NAV repricing, property
valuation, market dips), with **goal milestones** drawn on the line like map
destinations ("₹15L emergency fund — 62% there").

It is deliberately the *emotional* counterweight to the other two directions:
numbers still lead (finance-grade tabular numerals, honest nulls), but the
**narrative layer** — "you crossed ₹1Cr on 18 Aug" — is what makes a personal
finance app feel like it was designed *for you*, not for a spreadsheet.

Light and dark themes both first-class. Tabs become a **bottom-of-header
segmented nav** with a story-first home.

**The user-POV story:** *"I see my money as a line moving through time, with my
goals as destinations on it. Every month the line inches closer. When I hit a
milestone, the app tells me — 'You crossed ₹1Cr.' I'm not 'reviewing a dashboard'.
I'm watching my life get built."*

---

## 2. Creative portfolio-tracking concepts

| Concept | What it is | User-POV value |
|---|---|---|
| **Net-worth journey timeline** | The hero: a full-width `history.json` area chart, but *narrated* — milestone markers, event annotations (snapshots, NAV repricings, property import), and a subtle "today" cursor. The area under the line is the emotional fill. | "Where have I come from?" made visible |
| **Goal milestones on the line** | User-defined goals (localStorage: label + target ₹) drawn as horizontal threshold lines + progress chips ("Emergency fund — 62%"). Crossing one fires a confetti-free celebratory card. | Money becomes directional |
| **Milestone journal** | Auto-generated entries: "18 Aug 2026 — crossed ₹1Cr (₹1.03Cr)", "07 Aug — added real estate leg (+₹1.2Cr valuation)"… stored in localStorage, seeded from history deltas. | The app remembers your wins |
| **Account journeys** | Per-account mini timelines (zerodha INR, moomoo SGD, real_estate) under the main line — "the roads that built the highway". | Attribution without complexity |
| **Day-in-the-life view** | A "Today" panel: day P&L in words ("down ₹33.9k — moomoo −₹461, zerodha +₹658"), top mover, alerts. The briefing from D1, as a secondary panel. | Daily usefulness without losing the story |
| **Year-in-review teaser** | A "2026 so far" strip: started at X, now Y, +Z% — computed from history. | Gratitude + perspective |

**NOT included:** price candles (no per-holding history), social/sharing features
(private personal app — no public bragging), AI-written "insights" (determinism
boundary — all narration is computed from data, not LLM).

---

## 3. Look & feel — global chrome

### Header (48–56px) with segmented nav
```
┌──────────────────────────────────────────────────────────────────────┐
│ ◈ Journey   [ Journey | India | US | Returns | Alerts | Properties ] │
│                         ☀/🌙   ⬇   ⬡   👁                            │
└──────────────────────────────────────────────────────────────────────┘
```
- Brand: "Journey" wordmark + small mark.
- **Segmented control nav** (shadcn `tabs` kept, refined): Journey is the new
  default home; the other 5 views sit in a clean segmented pill, horizontally
  scrollable on mobile (the existing pattern, polished).
- Right cluster: theme toggle, refresh, chat, privacy — as D1.

### Content layout
```
┌────────────────────────────────────────────────────────────────────┐
│  THE JOURNEY                                                     ── │
│  ₹1.03Cr  ▲ +₹4.2k vs yesterday        [1M|3M|6M|1Y|All]          │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  ╭───────────────────────────● (goal: emergency fund 62%)    │ │
│  │  │   net worth over time     ──────────● crossed ₹1Cr 18 Aug │ │
│  │  ╰─────────────────────────────●───● (property added 07 Aug) │ │
│  └──────────────────────────────────────────────────────────────┘ │
│  ┌─────────────┬────────────────┬───────────────┐                │
│  │ Today       │ Account roads  │ Milestones    │                │
│  │ down ₹33.9k │ zerodha ──·    │ ✓ crossed ₹1Cr│                │
│  │ moomoo −461 │ moomoo  ──·    │ ▸ emergency 62%│                │
│  │ zerodha +658│ real_estate ── │ ▸ retirement  …│                │
│  └─────────────┴────────────────┴───────────────┘                │
└────────────────────────────────────────────────────────────────────┘
```
- **Hero journey chart:** ECharts area chart (history.json), gradient fill,
  milestone markers via `markLine`/`markPoint`, range pills, dataZoom.
- **Three side cards:** Today (words), Account roads (mini-sparklines), Milestones
  (goal progress + journal).
- **Footer:** the status strip from D1 (as-of, platform freshness, FX/NAV).

### What happens to the 6 tabs
Stays a tab system (least structural change of the three), with **Journey** added
as the default home tab. India/US/Returns/Alerts/Properties unchanged in structure,
upgraded by the round-1 polish (density, keyboard, sparklines, FilterBar,
CommandBar).

---

## 4. Dark AND light theme

Same mechanism (data-theme + `.dark`). The **journey chart gets theme-tuned
gradients**: dark = line in primary blue over a deep translucent fill; light =
line in deep blue over a soft blue-tinted fill. Semantic colors per theme:

### Light
| Token | Value | Note |
|---|---|---|
| `--background` | `oklch(0.985 0.002 285)` | |
| `--foreground` | `oklch(0.21 0.01 285)` | |
| `--card` | `oklch(1 0 0)` | |
| `--muted-foreground` | `oklch(0.48 0.012 285)` | AA |
| `--primary` | `oklch(0.55 0.18 262)` | Journey line |
| `--gain` / `--loss` | `0.52 0.14 155` / `0.55 0.19 25` | AA |
| `--chart-1..9` | AA-tuned categoricals | |

### Dark (audit-fixed)
`--loss 0.70`, `--gain 0.74`, `--warning 0.82`, `--muted-foreground 0.68` (as
D1/D2), `--primary 0.70 0.16 262` (brighter on dark).

---

## 5. Component inventory → shadcn/ui

| Need | shadcn primitive | Custom |
|---|---|---|
| Journey hero chart | `card` | `JourneyChart.tsx` (ECharts + markLine/markPoint + range pills + dataZoom) |
| Goal milestones | `progress` + `badge` | `GoalMilestones.tsx` (localStorage goals) |
| Milestone journal | `card` + `scroll-area` | `MilestoneJournal.tsx` |
| Today panel | `card` | `TodayPanel.tsx` (words + top mover) |
| Account roads | `card` | `AccountRoads.tsx` (mini sparklines per account from history.byGeography/byPlatform) |
| Segmented nav | `tabs` (polished) | — |
| Year strip | `card` | `YearStrip.tsx` |
| Command bar (lightweight) | `command` | `CommandBar.tsx` |
| Theme toggle | `dropdown-menu` | `ThemeToggle.tsx` |

**New primitives:** `command`, `dropdown-menu`, `progress`, `sonner` (milestone
celebration toast), `switch`. **Custom:** `JourneyChart`, `GoalMilestones`,
`MilestoneJournal`, `TodayPanel`, `AccountRoads`, `YearStrip`, `CommandBar`,
`ThemeToggle`.

---

## 6. Motion language

- **Journey line draw:** 800ms ease-out on mount (ECharts built-in), range-pill
  morph 400ms.
- **Milestone crossing:** a one-time celebratory card slides up 300ms + toast;
  respect reduced motion (card only, no confetti effects at all — calm by design).
- **Goal progress:** bars fill 500ms on view; numbers tick 400ms.
- **Tab switch:** 150ms fade.
- **Theme switch:** 200ms cross-fade.
- **Reduced motion:** all instant/opacity-only.

---

## 7. Award-winning references

- **Monzo / Revolut** — the "your money over time" story charts and milestone
  moments; personal finance with a pulse.
- **Apple Health / Fitness** — rings and journey metaphors that make progress
  *feelable*; the milestone-journal idea borrows their "achievement" pattern.
- **Wealthfront / Betterment** — goal-based investing UI: "your plan" as the hero,
  not the positions.
- **Linear** — restraint and typographic calm that keeps the emotional design from
  becoming kitsch.
- **Groww / Kuvera** — Indian MF investors' journey + goal tools (familiar UX for
  this user's market).

---

## 8. Trade-offs & effort

| Trade-off | Honest assessment |
|---|---|
| Story-first can under-serve the daily power user | The "Today" panel + unchanged India/US/Returns tabs keep raw data one click away |
| Goals/journal are localStorage-only | Honest limit without contract change; a future contract field could make them durable |
| Milestone narration is computed, not LLM | Deliberate — determinism boundary; the narration is "you crossed ₹1Cr", not "market commentary" |
| Least structural change vs D2 | That's the point: lowest risk, highest emotional payoff |

**Effort:** JourneyChart L · Goals S · Journal S · Today panel S · Account roads S ·
Year strip S · Theme system M · CommandBar M. **Total: 2 sessions.**

---

## 9. User-POV statement

> "I check my portfolio because I'm building something — a house, a cushion,
> freedom. This app shows me my money as a journey: a line through time, my goals
> as destinations, and it remembers the days I crossed a milestone. 'You crossed
> ₹1Cr.' When the market's red I see it in words — 'down ₹33.9k, mostly moomoo' —
> and I know it's one day on a long line. It's the first finance app that feels
> like it's about *my life*, not about a ledger."