# Round 2 — Direction 1: "The Daily Brief"

**Date:** 2026-08-18 · **Author:** ui-designer (orchestrator-written) · **Tagline:** *Know your money in 30 seconds, every morning.*

---

## 1. Concept

Stop treating the dashboard as a *collection of charts* and start treating it as a
**daily briefing you actually read**. The home screen is not a donut gallery — it's a
curated morning report that answers the only three questions a user asks at 8am:

1. **"How did I do?"** — net worth vs yesterday, day P&L in plain words.
2. **"What changed?"** — a diff feed: positions moved >±2%, NAV updates, stale
   platforms, fired alerts, captured trades.
3. **"Anything I must do?"** — expired/expiring sessions, stale data, rebalanced
   drift, alert-worthy events. A zero-item day shows a calm "All caught up."

The rest of the app is organized like a **financial command center**: a top command
bar (⌘K) that can jump to any holding, tab, or action from anywhere; a left nav that
groups the 6 existing views by *job* ("Watch", "Analyze", "Manage") instead of by
broker. Light and dark themes are both first-class, selected by a toggle and
defaulting to the OS preference.

**The user-POV story:** *"Every morning I open one page. I see '₹1.03Cr — up
₹4.2k vs yesterday. 2 positions moved more than 2%. Your moomoo session expires
tomorrow.' I don't hunt for information. It comes to me."*

---

## 2. Creative portfolio-tracking concepts (the "not just donuts" ask)

| Concept | What it is | User-POV value |
|---|---|---|
| **Morning Briefing home** | Narrative summary cards: yesterday vs today, top mover, worst mover, alerts, staleness. Collapsible to "just the numbers". | 30-second daily check-in, zero hunting |
| **What-changed diff feed** | A chronological stream: `+₹2.4k KPITTECH (3.1%)`, `NAV refreshed for 21 MFs`, `alert fired: platform stale`, `trades captured (2 new)`. Grouped by day. | "Show me what's different since I last looked" |
| **Goal progress rail** | Optional user-set goals (e.g. "Emergency fund: ₹5L") vs current value, as progress bars. Contract-safe: computed from `totals.valueBase` + localStorage-stored goals. | Turns tracking into *moving toward something* |
| **Session & staleness health** | Dashboard-wide status: all sessions fresh → green dot; something stale → amber with "what to do" text. | The #1 operational pain (daily 2FA) made visible |
| **XIRR journey per account** | Not one number — a small history sparkline per account with the honest "no trades yet" state. | "How is this account really compounding?" |

**Deliberately NOT included:** storytelling annotations on charts (D3 idea — too much
effort, low daily value), watchlist (you track what you own), social/benchmark noise.

---

## 3. Look & feel — global chrome

### Header (48–56px)
```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◈ Portfolio   [ ⌘K  Search holdings, tabs, actions…            ]  ☀/🌙  ⬇  ⬡  │
│                                                              Refresh  Chat │
└──────────────────────────────────────────────────────────────────────────┘
```
- **Brand mark:** small gradient tile + "Portfolio" wordmark (hidden on mobile).
- **Global search/command:** ⌘K input (shadcn `command` dialog on focus) — fuzzy
  search across holdings (ticker/name/platform), tabs, actions (refresh, theme,
  privacy, density, shortcuts). Read-only navigation + local actions; never pipeline
  writes.
- **Right cluster:** theme toggle (sun/moon, persisted), refresh button (with
  spinning state + toast), chat button, privacy eye toggle.

### Navigation — left rail (desktop) / bottom bar (mobile)
```
┌──────┬─────────────────────────────────────────┐
│ ◈    │  (content)                              │
│ Watch │                                          │
│   Overview                                      │
│   Alerts   ◐ 2                                  │
│ Analyze │                                          │
│   India │                                          │
│   US    │                                          │
│   Returns │                                          │
│ Manage │                                          │
│   Properties                                     │
│   Settings (new)                                │
└──────┴─────────────────────────────────────────┘
```
Grouped nav with section labels (Watch / Analyze / Manage) — the user navigates by
*intent*, not by remembering which broker a holding lives on. Alerts gets a count
badge. Active tab gets a left accent bar + `aria-current`.

### Footer (compact status strip)
```
┌──────────────────────────────────────────────────────────────┐
│ As of 18 Aug 09:52 IST · zerodha ✓ · moomoo ✓ · groww ✓    │
│ sharekhan 11d stale · FX USD/INR 84.2 · NAV 21 MFs · 69 holdings │
└──────────────────────────────────────────────────────────────┘
```
Per-platform freshness dots (green/amber), FX + NAV last-refresh, holding count.
This is the existing StatusBar, elevated into a proper footer with `role="status"`
and an `aria-live` region for the refresh toast.

### Tabs → what happens to them
The 6 tabs stay, but become **left-rail nav items grouped by job** (above). The
shadcn `Tabs` component is replaced by a nav-list + `aria-current` pattern (better
for grouping + keyboard). Mobile: bottom tab bar (thumb-reachable, 5 icons +
overflow).

---

## 4. Dark AND light theme — full token systems

Both themes defined in `:root` (light) + `.dark` (dark) CSS variables, switched by
`data-theme` on `<html>`, persisted, `prefers-color-scheme` as first-visit default.
The existing `@custom-variant dark` + `@theme inline` pattern extends 1:1.

### Light theme (new)
| Token | Value (oklch) | Notes |
|---|---|---|
| `--background` | `oklch(0.985 0.002 285)` | Near-white, cool |
| `--foreground` | `oklch(0.21 0.01 285)` | Ink |
| `--card` | `oklch(1 0 0)` | White cards, border-lifted |
| `--muted` | `oklch(0.955 0.005 285)` | |
| `--muted-foreground` | `oklch(0.48 0.012 285)` | ≥ 4.5:1 on white |
| `--border` | `oklch(0.9 0.008 285)` | Hairlines |
| `--primary` | `oklch(0.55 0.18 262)` | Deeper blue for contrast on light |
| `--gain` | `oklch(0.52 0.14 155)` | Darker green (AA on white) |
| `--loss` | `oklch(0.55 0.19 25)` | Darker red (AA on white) |
| `--warning` | `oklch(0.62 0.15 85)` | |
| `--chart-1..5` | `oklch(0.55 0.18 262)`, `0.52 0.14 155`, `0.62 0.15 85`, `0.55 0.19 25`, `0.6 0.14 300` | Saturated-but-dark, AA on white |

### Dark theme (fixed from audit)
| Token | Current | New | Fix |
|---|---|---|---|
| `--loss` | `0.63 0.2 25` | `0.70 0.17 25` | 4.2:1 → 5.3:1 |
| `--gain` | `0.72 0.15 155` | `0.74 0.14 155` | 5.1 → 5.9:1 |
| `--warning` | `0.8 0.14 85` | `0.82 0.13 85` | 7.2 → 7.8:1 |
| `--muted-foreground` | `0.66` | `0.68 0.012 285` | 12px labels AA |

### Mechanics
- `data-theme="light"|"dark"` on `<html>`; `.dark` class retained for shadcn compat.
- `color-scheme: light`/`dark` on `html` per theme (native scrollbars + form
  controls match).
- Chart palette: 9 categorical tokens per theme; `options.ts` `CATEGORY_COLORS`
  maps 1:1 (kills the audit §1 mismatch).
- Theme toggle: shadcn `dropdown-menu` with ☀️/🌙/Auto, persisted in localStorage,
  keyboard shortcut `T`.

---

## 5. Component inventory → shadcn/ui

| Need | shadcn primitive | Custom built on top |
|---|---|---|
| Global search | `command` (⌘K dialog) | `CommandBar.tsx` wrapper + fuzzy index |
| Left rail nav | `separator`, `button` (ghost) | `NavRail.tsx` grouped nav |
| Theme toggle | `dropdown-menu` | `ThemeToggle.tsx` |
| Refresh toast | `sonner` (toast) | — |
| Morning briefing cards | `card` | `BriefingCard.tsx` (diff-focused) |
| Diff feed | `card` + `badge` | `ActivityFeed.tsx` |
| Goal progress | `progress` | `GoalRail.tsx` (localStorage goals) |
| Staleness health | `badge` + `tooltip` | `HealthStatus.tsx` |
| Mobile bottom bar | `tabs` (reused) | — |
| Settings screen | `dialog` + `switch` + `select` | `SettingsScreen.tsx` |

**New primitives to install:** `command`, `dialog`, `dropdown-menu`, `sonner`,
`progress`, `switch`, `avatar`, `sheet` (if chat becomes a sheet instead of a custom
drawer). **Custom components:** `CommandBar`, `NavRail`, `BriefingCard`,
`ActivityFeed`, `GoalRail`, `HealthStatus`, `ThemeToggle`, `SettingsScreen`.

---

## 6. Motion language (no Framer Motion)

- **Briefing cards:** stagger-in 60ms each, fade + 6px rise, 300ms ease-out.
- **Diff feed:** new items slide-in 250ms; numbers tick (delta counter) 400ms.
- **Theme switch:** cross-fade 200ms via CSS (`body` transition on background/color).
- **Command bar:** scale+fade 150ms (dialog pattern), list filter is instant.
- **Nav rail:** active-item accent bar slides 200ms.
- **Refresh toast:** slide-up + auto-dismiss 4s.
- **Reduced motion:** all of the above become opacity-only 0ms/150ms; toasts stay.

---

## 7. Award-winning references (what to borrow)

- **Linear** — the command bar and grouped left nav; density; calm near-black dark
  theme. (The daily-brief card grid borrows Linear's "issue status" clarity.)
- **Vercel dashboard** — the compact status/footer strip, per-service freshness
  dots (our per-platform health dots are a direct mapping).
- **Stripe dashboard** — how a diff/activity feed narrates money movement; tabular
  numerals; the "all caught up" empty state.
- **Arc browser** — the ⌘T/⌘K everything-search mental model; space switching
  (our grouped nav is "spaces for money").
- **Apple Wallet / Groww** — a single glanceable number as the hero; morning
  notification-style summary.

---

## 8. Trade-offs & effort

| Trade-off | Honest assessment |
|---|---|
| Briefing home is opinionated | Some users want raw tables first — the "Numbers only" collapse handles it; left nav keeps tables one click away |
| Grouped nav is a behavior change | Learning cost is one session; intent-based grouping beats broker-memory |
| Goals need user input | localStorage-first, zero backend; real goals would need contract change (deferred) |
| Diff feed needs history | Already in `history.json` — platform/geography deltas are computable today; per-holding deltas need `latest.json` snapshots over time (2 days of runs already exist) |

**Effort:** Overview rebuild M · NavRail+header M · CommandBar L · Theme system M ·
ActivityFeed M · GoalRail S · Health/footer S · Settings screen S. **Total: 2–3
sessions.**

---

## 9. User-POV statement

> "I don't want to *explore* my portfolio. I want to *know* it. In the morning I see
> one screen: did I make money, what moved, what's broken. If I need more, ⌘K takes
> me straight to the holding or the India table. Light theme for daytime, dark for
> night, and it remembers. The only thing I ever *do* here is refresh — and it tells
> me when the data is fresh and when my session needs a login. That's the whole job."