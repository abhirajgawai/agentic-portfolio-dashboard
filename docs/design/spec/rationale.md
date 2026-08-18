# Rationale — Hybrid D1+D2 Design Decisions

**Date:** 2026-08-18 · **Author:** ui-designer · **For:** implementation handoff traceability

Every significant decision in this spec package, with the reasoning. Trace any implementation surprise back here before changing course.

---

## 1. Why Hybrid 1+2 (not pure D1, D2, D3, or 1+3)

| Option | Verdict | Reason |
|---|---|---|
| Pure D1 | Good but conservative | Fixes polish/a11y but misses the "modern app" energy the user asked for |
| Pure D2 | Risk of alienating | Compact-by-default + heavy density can feel cramped for casual glances; D2's mobile mitigation is a maintenance tax |
| Pure D3 | Rejected | Story view + spotlight rail = new IA, new learning curve, most novel code; user's existing mental model (6 tabs) stays |
| **1+2 (chosen)** | Best signal/cost | D1 provides the *foundation* (tokens, contrast, motion discipline, a11y) that makes D2's *features* (density, sparklines, command bar) feel premium instead of cramped. Both are additive to the current IA — no restructuring, no contract change, deterministic boundary intact. |
| 1+3 | Second best | Story view is compelling but overlaps with the chat agent's job (explaining the portfolio). Keep the agent in the drawer where it already works. |

---

## 2. Density: comfortable default, compact opt-in

- **Why not compact-by-default (D2's stance)?** The dashboard is opened daily for quick checks AND occasionally for analysis. Defaulting to 30px rows makes the first impression dense. Comfortable default + one-toggle compaction serves both.
- **Why keep the toggle?** Power users get 30px rows, 12px type, more rows per screen — the D2 win without the D2 risk.
- **Auto-comfortable < 640px:** touch targets ≥44px and readability on phones win over density. This is a hard rule, not a suggestion (a11y spec §7).

## 3. Sparklines: platform series, not per-holding

- **The honest constraint:** `contract.ts` has NO per-ticker price history — `history.json` only carries `byPlatform[]` series. The contract is immutable (guardrail), so per-holding sparklines would require **fabricating** data. We refuse.
- **What we show instead:** the platform's value trend across recent snapshots. It's real, it's in the contract, and it gives the row a visual rhythm that plain text lacks. The row's own current values remain the authority.
- **Future:** if/when `get_historical_data` (Kite) feeds a per-ticker series, the sparkline swaps its data source without changing the component.

## 4. No Framer Motion — CSS + ECharts only

- Bundle budget: +50KB max. Framer Motion ≈ 40–50KB alone — it would consume the entire allowance.
- CSS keyframes + Tailwind `animate-*` + ECharts built-in animation cover every motion in the spec (entrance, counters, cross-filter, chart draw). ECharts already animates option changes (`animationDurationUpdate`) for free.
- Result: motion infrastructure ≈ 2KB. The remaining budget goes to the command bar + dataZoom + sparkline wiring.

## 5. Command bar is read-only navigation, never pipeline

- It fuzzy-searches holdings/tabs and triggers LOCAL actions (refresh = existing bridge POST, privacy, density). It cannot write to the pipeline, cannot touch broker MCPs, cannot open files — consistent with guardrails #1/#2. "Refresh now" already exists and goes through the bridge's `POST /api/refresh`, which shells to the real CLI — the command bar just reuses that same path.

## 6. `<h1 className="sr-only">` per screen — pragmatic hierarchy fix

- Audit §6 flagged a flat heading hierarchy (no real h1). Redesigning visual headings would fight the card-centric layout and churn every screen.
- sr-only h1 gives screen readers a proper document outline with zero visual change. Cheap, correct, standard practice.

## 7. Keyboard-first table (sort + arrow-nav + aria-sort)

- Audit §6: sort was click-only; headers lacked focus. Wrapping header labels in `<button>` inside `<th scope="col">` gives native keyboard semantics + free screen-reader announcement. Arrow-key row nav uses `aria-activedescendant` — the standard pattern for grids that aren't full `role="grid"` (avoids the tab-index complexity of roving grid focus while keeping SR coherence).

## 8. DataZoom on trend chart

- History is short today (5 points) but compounds with age (M1 note: "time-series value compounds with age"). dataZoom + range pills future-proof the chart now, when it costs nothing, instead of retrofitting when 200 points exist. ECharts `DataZoomComponent` is already in the modular set — bundle impact ≈ few KB.

## 9. `--loss` token change is the single most important fix

- The audit found negative P&L numbers (red, `oklch(0.63 0.2 25)`) sit at **4.2:1** on the background — below the 4.5:1 AA threshold. Every loss figure in every table/chart was failing. Raising lightness to 0.70 (5.3:1) fixes the entire app at once, because `--loss` is used everywhere. This is the difference between "audit said AA" and "actually AA".

## 10. What we deliberately did NOT include

| Excluded | Why |
|---|---|
| Story view / spotlight rail / annotated narrative charts (D3) | IA change + overlap with chat agent; user picked 1+2 |
| Per-holding sparklines | Data doesn't exist in the immutable contract (§3) |
| Framer Motion | Bundle budget (§4) |
| Column resize persistence | Nice-to-have; adds TanStack column-sizing surface area + storage; defer to a later pass |
| Benchmark comparison lines (NIFTY/S&P) | No data source in contract; future M9/Supabase feature |
| Light theme | Dark-only is a locked decision (PLAN.md M8) |