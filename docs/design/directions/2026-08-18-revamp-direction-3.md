# Direction 3 — "Guided Insight" (Story. Focus. Context.)

**Date:** 2026-08-18 · **Author:** ui-designer · **Tagline:** *Story · Focus · Context*

---

## 1. Concept

This direction turns the dashboard from a *toolbox* into a *narrative*. Instead of six flat tabs, the app opens on a single **Story view** — an executive summary that tells you *"here's what changed today, here's what matters, here's what needs your attention"* — then lets you drill into any insight to reach the raw data. Key mechanism: **progressive disclosure with smart defaults**. Cards are collapsed into "insight summaries" with an expand affordance; charts carry **annotations** (callouts on the biggest mover, the deepest loss, the stale platform); a **spotlight panel** (left rail) shows context for whatever you're looking at — click a donut slice and the panel explains that allocation and links to the underlying holdings. The aesthetic is "Notion meets a premium fintech app (Robinhood/Groww India app)": warmer dark surfaces, a touch more saturation in cards, generous whitespace, friendly empty states, and motion that *guides* (a subtle focus ring travels to the newly-relevant card when you interact). This is the most opinionated direction and the best for an **occasional user** who wants to understand their money, not operate an instrument.

---

## 2. Mood Board

| Reference | What to borrow |
|---|---|
| **Robinhood** | Story-first layout: one hero card (today's P&L) on top, insight cards below, each expandable; "attention" list of things to check |
| **Groww / Zerodha app** | Indian fintech warmth: friendly copy ("You're up ₹186 today 🎉"), rupee formatting done right, progress bars for allocation |
| **Notion** | Content-first typography (big serif-ish headings on cards), whitespace as a design element, calm secondary text |
| **Apple Stocks** | Annotated charts — callouts on notable points ("1y high", "biggest day"), clean axis, minimal gridlines |
| **Linear (insights)** | "What changed" panels: a summary strip of deltas per platform, each clickable |

**Design language summary:** *Explain before you expose.* Every surface says *what it means* before *what it contains*. Motion narrates: when you click a sector slice, a light "trail" draws to the filtered holdings table.

---

## 3. Token Diff

### Colors (warmer dark, slightly more saturated)
| Token | Current | Proposed | Why |
|---|---|---|---|
| `--background` | `oklch(0.13 0.006 285)` | `oklch(0.15 0.010 285)` | Warmer/lighter backdrop; cards pop without shadows |
| `--card` | `oklch(0.165 0.007 285)` | `oklch(0.19 0.012 285)` | Lighter card surface for the "paper" feel |
| `--card-foreground` | `oklch(0.97 0.004 285)` | `oklch(0.98 0.006 285)` | Brighter text on lighter cards |
| `--loss` | `oklch(0.63 0.2 25)` | `oklch(0.72 0.16 25)` | **A11y fix** — also *less alarmist* red for a storytelling UI |
| `--gain` | `oklch(0.72 0.15 155)` | `oklch(0.75 0.14 155)` | Cheerful, warm green |
| `--primary` | `oklch(0.68 0.16 262)` | `oklch(0.72 0.18 262)` | More vivid accent for CTAs + focus trail |
| `--warning` | `oklch(0.8 0.14 85)` | `oklch(0.84 0.13 85)` | Softer amber for "attention" not "alarm" |
| `--muted-foreground` | `oklch(0.66 0.012 285)` | `oklch(0.70 0.012 285)` | Friendly secondary text (7:1) |
| `--border` | `oklch(0.26 0.012 285)` | `oklch(0.28 0.014 285)` | Visible-but-soft card edges (cards are the surface here) |
| `--chart-*` | 5 | **9** | Richer categorical palette for annotated charts |

### New: Typography (Content-First)
```css
:root {
  --font-display: 'Inter', ui-sans-serif, system-ui, sans-serif; /* headings */
  --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Menlo, monospace;         /* numbers only */
  --text-hero: 32px;      /* story hero value */
  --text-h2: 20px;        /* insight card title */
  --text-h3: 16px;        /* sub-section */
  --text-body: 14px;      /* body copy */
  --text-caption: 12px;   /* annotations, meta */
}
```

### New: Annotation Tokens
```css
:root {
  --annotation-bg: oklch(0.20 0.02 262 / 0.35);   /* soft indigo tint */
  --annotation-border: oklch(0.72 0.18 262 / 0.4);
  --attention-glow: 0 0 0 1px oklch(0.84 0.13 85 / 0.6), 0 0 12px oklch(0.84 0.13 85 / 0.25);
}
```

### Spacing / Shadow / Motion
Spacing scale `--spacing-1..8` (shared); shadows are **lighter** than D1 (cards rely on bg + border, only modals/popovers shadow); motion tokens same as D1 (`--ease-out` expo, `--duration-fast/base/slow`).

---

## 4. Component Anatomy Table

| Current | Proposed |
|---|---|
| `AppShell` | New **Story view** replaces Overview as the default tab; left **Spotlight rail** (context panel, 280px, collapsible); tabs reduced to [Story][Holdings][Returns][Alerts][Chat] (India/US merge into Holdings with a geo toggle) |
| `StatusBar` | Story-friendly: shows "as of" with friendly relative time ("12 min ago"), platform health dots with tooltips, alert count as a soft pill |
| `OverviewCards` → `StoryHero` | One **hero card** (today's P&L, big number + direction arrow + friendly sentence) + 3 supporting insight cards (Net worth, Return, XIRR) as a horizontal strip; each expandable to a detail card |
| `AllocationDonuts` → `AllocationInsights` | Each donut becomes an **insight card**: title is a *question* ("Where's my money?") with an answer sentence ("67% India, led by mutual funds"), donut + top-3 list; click slice → spotlight explains + links to filtered holdings |
| `TrendChart` | **Annotated**: automatic callouts for max/min points + "biggest single-day change"; range pills; optional benchmark toggle (future: NIFTY/S&P) |
| `HoldingsTable` | **Insight-first**: default shows "Top movers today" + "Deepest losses" + "Biggest positions" as 3 small lists; full sortable table is one click away (progressive disclosure) |
| `ReturnsScreen` | Kept mostly as-is (it already tells a story) but gets annotations on bars ("best/worst") + friendly empty states |
| `AlertsScreen` | Rebranded "What needs attention" — alerts grouped by severity with a sentence lead ("1 thing to check today") |
| `ChatDrawer` | Integrated into the spotlight rail (context-aware: the rail becomes the chat surface when you ask a question); keeps the honest offline state |
| `SpotlightRail` (new) | Left panel that updates as you interact: click sector slice → shows sector explanation + holdings list; click holding → shows position detail + return trend |

---

## 5. Screen Wireframes

### Story (new default tab)
```
┌──────────────────────────────────────────────────────────────┐
│ ● Portfolio  [Story][Holdings][Returns][Alerts]   ▤ 💬 👁 ⟳  │
│ Spotlight ◀──────────── main ──────────────────────────────▶ │
│ ┌──────────┐ ┌─────────────────────────────────────────────┐│
│ │ Context  │ │ Hero:  You're up ₹186 today ▴ +0.03%         ││
│ │ (context │ │        Net worth ₹67.98L (as of 12 min ago)  ││
│ │  of the  │ ├─────────────────────────────────────────────┤│
│ │  thing   │ │  Net Worth       Return        XIRR          ││
│ │  you're  │ │  ₹67.98L         +46.48%       — (no trades) ││
│ │  looking │ │  ▴ 7d +1.2%      cov 48/68     honest badge  ││
│ │  at)     │ ├─────────────────────────────────────────────┤│
│ │          │ │ "Where's my money?"                          ││
│ │          │ │  IN ████████████ 67%   MF ███████ 39%        ││
│ │          │ │  US ██████ 33%        ETF ████ 26%           ││
│ │          │ │  [geography][platform][sector][asset] chips  ││
│ │          │ ├─────────────────────────────────────────────┤│
│ │          │ │ "How has it grown?"   [1M][3M][6M][1Y][All]  ││
│ │          │ │  ▁▂▃▅▆█▇▅▂▁  ⚑ max: 08-07 · ⚑ min: 06-30   ││
│ │          │ └─────────────────────────────────────────────┘│
│ └──────────┘  ↓ "Needs attention" (1) → [Alerts]             │
└──────────────────────────────────────────────────────────────┘
```

### Holdings (insight-first)
```
┌──────────────────────────────────────────────────────────────┐
│ [India] [US]  toggle                                          │
│ ┌───────────────────────────────────────────────────────────┐│
│ │ Today's movers   ▴ ZENTEC +5.4% · ▴ SONACOMS +1.5%        ││
│ │                  ▾ INFY −2.2%  · ▾ HCLTECH −2.0%          ││  ← top-3 lists
│ │ Deepest losses   ▾ KPITTECH −47.9% · ▾ RVNL −46.1%        ││
│ │ Biggest positions ▴ APARINDS ₹3.53L · LT ₹1.22L · SMH      ││
│ │                    ₹7.8K (SGD)                             ││
│ │ [View full table →]                                        ││  ← progressive disclosure
│ └───────────────────────────────────────────────────────────┘│
│ (Full HoldingsTable revealed on demand — reused, dense)      │
└──────────────────────────────────────────────────────────────┘
```

### Returns / Alerts / Chat
- **Returns:** existing layout + bar annotations ("best", "worst") + friendly empty states.
- **Alerts → "Needs attention":** severity-grouped with a lead sentence; ruleId demoted to a `title` tooltip (plain language message first, rule ID second).
- **Chat:** lives in the Spotlight rail — click 💬 → rail swaps context → chat; keeps tool chips + offline banner.

---

## 6. Motion Specs

| Motion | Trigger | Duration | Easing | Notes |
|---|---|---|---|---|
| Story hero entrance | Mount | 400ms | `--ease-out` | `translateY(12px)→0` + `opacity` + slight `scale(0.99)→1` |
| Insight card stagger | Mount | 300ms each | `--ease-out` | 60ms stagger, max 5 |
| Focus trail | Click a slice/row | 350ms | `--ease-out` | A soft indigo ring travels to the target card (SVG path, GPU-only) |
| Card expand | Click "View more" | 250ms | `--ease-out` | Height `max-height` animation + content fade; no layout shift (reserve space) |
| Chart annotation callout | Chart mount / data change | 500ms | `--ease-out` | ECharts `graphic` elements fade + slide in after line draw |
| Spotlight update | Interaction anywhere | 200ms | `--ease-in-out` | Rail content cross-fade; title of new context slides in |
| Donut slice emphasis | Hover | 250ms | `--ease-out` | `scaleSize: 6` + border glow (attention) |
| Refresh complete | API returns | toast 300ms in / 4s / 200ms out | `--ease-out` | Friendly copy: "Fresh data — pulled 35 Zerodha + 6 Moomoo positions" |

**Reduced motion:** all → 0ms; focus trail becomes instant highlight; annotations appear statically.

---

## 7. Trade-offs

| Axis | Choice | Cost |
|---|---|---|
| **Narrative vs. control** | Story-first | Power users must click deeper to reach raw data; some may find the story view "slow" |
| **Opinionated** | Smart defaults (top movers, deep losses) | Which movers/losses are shown is a design decision; users can't fully reconfigure (v1) |
| **IA change** | Holdings tabs merged (India/US → geo toggle) | Breaks current tab structure; users' mental model changes; more work on the bridge? (No — same data, new grouping) |
| **Spotlight rail** | Persistent left context panel | 280px of horizontal space on desktop; complexity of "context sync" logic |
| **Effort** | Highest design novelty, medium-high effort | ~4 evenings; most "new" UI code (spotlight, annotations, story hero) |
| **Mobile** | Spotlight collapses to a bottom sheet on tap | More mobile-specific states |

**Who it serves:** Someone who opens the dashboard a few times a week and wants to *understand* their money, plus visitors who'd be confused by dense tables. Best "wow" for perceived intelligence of the app.

---

## 8. Effort Estimate

| Screen / Component | Effort |
|---|---|
| Token system (warmer palette, display type, annotations) | **M** |
| StoryHero (hero + insight strip, expandable) | **M** |
| SpotlightRail (context sync + chat integration) | **L** |
| AllocationInsights (question cards + slice links) | **M** |
| Annotated TrendChart (callouts, range pills) | **M** |
| Holdings insight-first (movers/losses lists + table behind) | **M** |
| Holdings geo toggle (India/US merge) | **M** |
| Alerts "Needs attention" rebrand | **S** |
| Returns annotations + friendly states | **M** |
| Focus trail + motion pass | **M** |
| Mobile bottom-sheet spotlight | **M** |
| **Total** | **~4 evenings** |
