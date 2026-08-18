# Rationale — Journey OS (Hybrid 2+3)

**Date:** 2026-08-18 · **Author:** ui-designer (orchestrator-written) · **For:**
implementation handoff traceability.

---

## 1. Why 2+3 (not pure 2, pure 3, or 2+1)

- **Pure Portfolio OS (D2)** is the most powerful but emotionally cold — a
  terminal is great when you know what you're looking for, but the default home
  would be a table. The user's ask was "the best way and a single place to track
  my portfolio" — tracking includes *watching it grow*, which is a story, not a
  grid.
- **Pure Journey (D3)** is the most emotional but structurally light — tabs +
  one hero chart doesn't deliver "single place" the way a master-detail workspace
  does.
- **2+3 resolves it:** the OS shell (D2) gives the *single place*; the Journey
  workspace (D3) gives the *reason to look*. The left universe pane is always
  there for "tell me about X"; the center defaults to the story; the right rail
  answers "what should I do?"
- **Not 2+1 (OS + Daily Brief):** the Brief's "what changed" feed overlaps with
  the AttentionRail + TodayPanel; adding both would be redundant. The Journey's
  narrative layer is the differentiator the user explicitly asked for ("think
  creative", "from user POV").

## 2. Land in the story, work in the data

The single most important IA decision. Defaulting the center pane to the Journey
timeline means the first thing a user sees is *progress through time*, not a
spreadsheet. But the universe pane keeps the power-user path one click away. The
dossier (select → detail) preserves the master-detail magic of D2 without a
separate "holdings home".

## 3. Contract honesty — what we could NOT build

- **Per-holding 7-day sparklines** are impossible today: the contract has
  `history.byPlatform` but no per-ticker history. The dossier + table sparklines
  therefore show the **platform series** with an explicit label. A future
  contract field (per-ticker price history) would upgrade them; the component
  interface is designed so the data source can swap without rework.
- **Durable goals** would need a contract field (goals live in the DB, not the
  dashboard). localStorage keeps them honest, private, and zero-backend. The
  goals are a dashboard affordance, not a ledger fact.
- **Journey milestones** are computed from `history.json` deltas (crossing
  thresholds, largest jumps) — deterministic, no LLM. This preserves the
  determinism boundary: the narration is arithmetic, not opinion.

## 4. Why light + dark both

The user explicitly asked for both themes ("the dark and light theme"). The
current file is dark-only; tokens.json defines full palettes for both, with
`data-theme` + `.dark` compat so shadcn components work unchanged. The audit's
contrast fixes are applied to the dark theme AND the light theme gets AA-tuned
semantic colors from the start (a common failure: light themes ship `gain`/`loss`
too pale).

## 5. Why panes, not tabs, and why tabs still exist

The user said "single place". A tab bar is a *hallway*; a three-pane workspace is
a *room*. But the 6 existing views remain as center-pane workspace modes — no
feature is lost, no data is hidden, and ⌘1..⌘6 + the segmented control keep them
switchable. The old Overview screen is retired because the Journey workspace IS
the overview (totals + trend + alerts + movers) — with more story.

## 6. Why the round-1 spec is superseded

Round 1 (Hybrid D1+D2 polish) targeted the existing tab layout. Implementing it
inside the new shell would mean building the same density/keyboard/sparkline/
theme machinery twice. This spec absorbs round-1's component work (density,
keyboard table, FilterBar, CommandBar, a11y fixes, toasts, skeletons) into the
new shell and implements it once. Round-1 docs remain on disk for the decisions
they contributed.

## 7. Exclusions (deliberate)

- **Resizable floating panes** (D2's wilder idea): fixed-width panes with
  collapse toggles are simpler, more robust, and 90% of the value.
- **Price candles / per-ticker charts:** not in the contract (see §3).
- **Social/sharing:** private personal app; no public surface.
- **Confetti/celebrations:** calm by design; a toast + card, not a party.
- **LLM insights:** determinism boundary. All narration computed from data.

## 8. Risk register

| Risk | Mitigation |
|---|---|
| 3-pane shell feels cramped at 1024px | Right rail collapses <1280px; panes collapse on demand; density toggle |
| Journey chart data is sparse (few history points yet) | Honest empty/short-series states; range pills still work; milestones seed from what exists |
| Cross-filter surprises users | Click-to-filter with `aria-pressed` + visible "clear" affordance; Journey excluded by design |
| Bundle creep | +50KB budget enforced in verification; ECharts stays tree-shaken; no new libs |
| Migration cost (Overview/StatusBar retired) | Retire only after all consumers are re-homed; verified in the build pass |