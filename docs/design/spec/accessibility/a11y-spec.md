# Accessibility Specification — Dashboard Revamp (Hybrid D1+D2)

**Baseline:** WCAG 2.1 AA. Audit findings (`docs/design/audit/2026-08-18-design-audit.md §6`) drive this list — each item closes a documented gap.

---

## 1. Contrast (audit-critical)

| Pair | Fix | Target |
|---|---|---|
| `--loss` text on `--background` | `--loss: oklch(0.70 0.17 25)` | 4.2:1 → **5.3:1** ✅ AA |
| `--loss` on `--card` | same token | ~4.6:1 ✅ AA (check with tool) |
| `--muted-foreground` (12px labels) | `oklch(0.68 0.012 285)` | → **6.4:1** ✅ |
| `--border` (non-text UI) | `oklch(0.24 0.012 285)` | ≥3:1 for meaningful borders (focus ring uses `--ring` 2px) |

Verify after implementation with a contrast checker on the actual rendered pairs (bg-background, bg-card, bg-muted, bg-accent).

---

## 2. Semantic Structure

| Element | Requirement |
|---|---|
| Screen headings | Each screen's root section has a real `<h1>` (screen title). Card titles stay `CardTitle` (h3-level role) but ensure at least one h1 per screen — audit flagged flat hierarchy. **Concretely:** add `<h1 className="sr-only">Overview</h1>` (etc.) per screen root; keep visual design unchanged. |
| Table headers | `<th scope="col">` on all column headers (audit ❌). |
| Sort state | `aria-sort="ascending\|descending\|none"` on sorted `<th>`; update on sort toggle. |
| Live regions | Refresh toast: `role="status"` + `aria-live="polite"`; chat messages: `role="log"` + `aria-live="polite"`; stat counters: `role="status"` around the counter element (announce final value). |
| Charts | Each donut + trend chart: visually-hidden data `<table>` (caption = chart title, rows = name/value) with `aria-describedby` link from the chart container. ECharts canvas gets `role="img"` + `aria-label` (concise summary: "Allocation by geography: India 67%, US 33%"). |
| Command bar | `role="combobox"` input + `role="listbox"` results + `role="option"` items + `aria-activedescendant`. |
| Filter pills | `role="group"` + `aria-label` per group; `aria-pressed` on each pill. |
| Density toggle | `aria-pressed`, `aria-label="Toggle table density"`. |
| Shortcuts dialog | `role="dialog"` + `aria-modal="true"` + `aria-labelledby`; Esc closes; focus moves into dialog and returns to trigger. |

---

## 3. Keyboard Navigation (audit ❌ items)

| Interaction | Fix |
|---|---|
| Sortable table headers | `tabIndex={0}`, Enter/Space toggles sort (native button semantics — wrap header content in a `<button>` inside `<th>` for free a11y, styled as plain text). |
| Filter pills | Already `<button>`s — add visible `focus-visible` ring (`outline 2px var(--ring), offset 2px`). |
| Chat suggestion buttons | Add `focus-visible` ring (same). |
| Refresh button | Ensure `focus-visible` ring (exists in StatusBar — verify). |
| Table row navigation | Arrow Up/Down move row selection; `aria-activedescendant` on the table wrapper; Home/End jump first/last; Enter = (future) drill. Row selection visually = `bg-accent/60`. |
| Global shortcuts | `/` focuses search (per-screen search input), `r` refresh, `?` shortcuts dialog, `⌘K`/`Ctrl+K` command bar, `d` density toggle. Announce via `role="status"` toast on first activation? No — keep `?` dialog as the discoverable reference. |

---

## 4. Focus Management

- Every interactive element: `:focus-visible` → `outline: 2px solid var(--ring); outline-offset: 2px` (or shadcn's `focus-visible:ring-*`).
- Command bar: trap focus while open (Tab cycles within; Esc closes and returns focus to trigger).
- Shortcuts dialog: same trap.
- Chat drawer: on open, focus moves to the textarea; on close, focus returns to the Chat button (verify current behavior).

---

## 5. Screen Reader Notes

- Masked mode: values become MASK_TEXT — screen readers should read "masked"; keep `aria-label="Amount hidden"` on masked spans if announced text is misleading. (Low priority — verify only.)
- Donut hidden tables: announced as data — this is the required alternative for canvas charts.
- Stale badges: `title` + visually-hidden "stale" text in the badge (`<span className="sr-only">stale</span>`).
- Trend chart tooltip info (values) lives in the chart; the hidden table covers it.

---

## 6. Reduced Motion

Global CSS (see motion spec §6) + JS `matchMedia('(prefers-reduced-motion: reduce)')` for counters/ECharts animation. Verify via devtools emulation: no entrance stagger, instant numbers, charts render without draw.

---

## 7. QA Checklist

- [ ] `--loss` numbers readable on `bg-background` and `bg-card` (5.3:1 / 4.6:1)
- [ ] `<h1>` present (sr-only) per screen
- [ ] `<th scope="col">` + `aria-sort` on sortable columns
- [ ] Keyboard: Tab reaches sortable headers, pills, refresh; Enter/Space activates
- [ ] Arrow keys move table row selection; screen reader hears `aria-activedescendant`
- [ ] Charts have hidden data tables + `role="img"` labels
- [ ] Chat `role="log"` announces new messages
- [ ] Command bar focus-trapped; Esc closes; focus restored
- [ ] `?` dialog lists all shortcuts; focus returns on close
- [ ] Reduced motion: no animations
- [ ] Touch targets ≥44×44 on mobile (density auto-comfortable handles rows; verify pills/buttons)