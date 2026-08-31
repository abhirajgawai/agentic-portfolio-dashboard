# Handoff: Propagate the Look-and-Feel Modernization to the Remaining Workspaces

**Written 2026-08-31, end of a Claude Code session, for an OpenCode agent
(`dashboard-builder`) to execute — written assuming a smaller/less capable
model than the one that designed it, so every step is spelled out literally,
with exact find/replace blocks instead of line numbers (line numbers drift,
exact strings don't). Follow this document exactly. Do not improvise, do
not "also fix" things not listed here, do not skip §5 (Non-goals).**

The user's own words for what's wanted: **"not only typography, look & feel,
components, modern look and feel — everything should be updated."** This
document's scope was expanded accordingly from an earlier, typography-only
draft — read §1 for what "everything" concretely turned out to mean once
the codebase was actually audited (most of "everything" was already global
and automatic; a handful of concrete per-page gaps were found and are
listed in §3).

---

## 1. What already happened this session (context — already shipped, don't redo)

The Journey (landing) workspace had a rendering bug fixed (milestone label
overlap — not your concern, done). Separately, the user said the whole app
"looks very old," which led to a **global look-and-feel modernization**,
all of it already live and verified (both themes, in a running browser) by
the time this document was written:

### 1a. Color tokens (`dashboard/src/index.css`) — global, automatic

The palette was generic cool-indigo-on-gray (the default look of most
shadcn-based dashboards: blue-262 primary, gray-285 neutrals). Replaced
with a warm bronze-gold `--primary` (hue 65-68) over warm charcoal/paper
neutrals (hue 55-75), in **both** light and dark themes. This is a design
token change — every component using Tailwind's semantic classes
(`bg-primary`, `text-foreground`, `border-border`, `bg-card`, etc., which
is all of them) inherited it automatically. **Broker-identity chart colors
(`--chart-1`..`--chart-9`) were deliberately left untouched** so
Zerodha/Moomoo/Groww/Sharekhan stay visually distinct and consistent across
the app — do not touch these.

### 1b. Shadow tokens wired up — global, automatic

`index.css` already had a tuned `--shadow-xs/sm/md/lg` scale defined, but
it was **dead code** — every component was using Tailwind's generic
built-in `shadow-sm`/`shadow-lg` instead, because the custom shadows were
declared under plain `:root`/`.dark` instead of inside the `@theme inline`
block Tailwind v4 actually scans for utility overrides. Fixed by adding
four lines to the `@theme inline` block in `index.css`:

```css
--shadow-xs: var(--shadow-xs);
--shadow-sm: var(--shadow-sm);
--shadow-md: var(--shadow-md);
--shadow-lg: var(--shadow-lg);
```

Every `shadow-sm`/`shadow-lg` class in the app (Card, Button, Dialog,
chart tooltip, Header, ChatDrawer, Textarea — ~10 files) now renders the
theme-tuned shadow instead of Tailwind's generic gray one, automatically,
with zero per-component edits. **Do not touch these four lines or the
underlying `--shadow-*` values.**

### 1c. `Card` primitive refresh — global, automatic

`dashboard/src/components/ui/card.tsx` was 100% unmodified stock shadcn:
`rounded-lg border bg-card text-card-foreground shadow-sm`. Every `<Card>`
in the entire app (there are dozens) is this one component. Changed to:

```tsx
'rounded-xl border border-border/70 bg-card text-card-foreground shadow-sm'
```

(Slightly larger radius, slightly softer border.) **Do not touch this
file.** If you think a specific card needs a different treatment, override
it locally via that card's own `className` prop — never edit the shared
primitive again without flagging it first.

### 1d. Signature headline typography — applied to exactly 3 hero figures

One new CSS class, `.font-headline` (in `index.css`, loads Google Font
"Fraunces" via a `<link>` in `dashboard/index.html`), used for the *one*
large money figure that is the primary thing a screen shows — deliberately
not applied to every number in the app (spend the one signature moment in
one place, keep everything around it quiet — this is a design choice, not
an oversight). Already applied to:

1. Journey's "Net worth" headline
   (`dashboard/src/components/journey/JourneyWorkspace.tsx`, `Headline`).
2. Portfolio's "Consolidated" featured segment card
   (`dashboard/src/components/segments/SegmentCard.tsx`) — only the
   `featured` variant; the India/US/CAS peer cards next to it stay plain
   sans, unchanged, on purpose.
3. Properties' "Total Value" summary card
   (`dashboard/src/components/holdings/PropertiesScreen.tsx`) — only that
   one card; "Total Invested" and "Unrealized Gain" next to it stay plain
   sans, unchanged, on purpose.

**These three are already done. Do not re-touch them. Do not add
`.font-headline` anywhere else** — see §5.1 for exactly which screens have
no hero figure and must not get one invented.

---

## 2. Prerequisite — confirm the baseline matches what this doc assumes

Before touching anything, from `dashboard/`:

```sh
grep -n "^\s*--primary:" src/index.css
grep -n "font-headline" src/index.css
grep -n "shadow-xs: var(--shadow-xs)" src/index.css
grep -n "rounded-xl border border-border/70" src/components/ui/card.tsx
grep -n "font-headline" src/components/segments/SegmentCard.tsx src/components/holdings/PropertiesScreen.tsx
```

All five must find a match. If any is missing, this session's changes
haven't landed in your branch yet — **stop and tell the user**, don't
reimplement any of §1 yourself from this doc's description (that risks a
second, slightly different "first" definition of the same tokens).

---

## 3. Your actual task — three small, concrete, per-page gaps

Once the codebase was actually audited page by page (not guessed at), it
turned out almost everything the user meant by "everything" was already
covered by §1's global changes. Only three concrete, page-specific gaps
were found. Fix exactly these three, nothing else.

### 3a. Alerts workspace has no page header at all

File: `dashboard/src/components/alerts/AlertsScreen.tsx`

Every other workspace (Journey, Properties, Groww/Sharekhan Data) has a
visible title + one-line description at the top; Portfolio deliberately
leads with its Consolidated card instead (sr-only `<h1>`, established
pattern, don't change it). Alerts currently has **no visible heading at
all** — it jumps straight into a card. That reads unfinished next to every
other screen. Fix by matching the exact pattern Properties already uses.

Find (the start of the return statement):

```tsx
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex-col gap-2 pb-1 sm:flex-row sm:items-center sm:justify-between">
```

Replace with:

```tsx
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-semibold">Alerts</h1>
        <p className="text-sm text-muted-foreground">
          Rule evaluation results from the last export — thresholds, ops, and
          severities live in data/rules.yaml.
        </p>
      </div>
      <Card>
        <CardHeader className="flex-col gap-2 pb-1 sm:flex-row sm:items-center sm:justify-between">
```

### 3b. Allocation workspace has no page header at all

File: `dashboard/src/components/overview/AllocationScreen.tsx`

Same gap, same fix pattern. Find:

```tsx
  return (
    <div className="space-y-4">
      <AllocationDonuts allocation={latest.data.allocation} />
```

Replace with:

```tsx
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Allocation</h1>
        <p className="text-sm text-muted-foreground">
          Portfolio composition by asset class and platform, plus today's
          biggest movers.
        </p>
      </div>
      <AllocationDonuts allocation={latest.data.allocation} />
```

### 3c. Alert rows don't have the row-hover state every other list/table in the app has

File: `dashboard/src/components/alerts/AlertsScreen.tsx`, the `AlertRow`
function.

`HoldingsTable.tsx` (the Portfolio table) already has
`hover:bg-accent/40` on its data rows — that's the established row-hover
convention in this codebase. `AlertRow`'s `<li>` doesn't have it, so the
list looks static/flat next to every other data list. Find:

```tsx
    <li className="flex items-start gap-3 border-b border-border/50 px-4 py-3 last:border-0">
```

Replace with:

```tsx
    <li className="flex items-start gap-3 border-b border-border/50 px-4 py-3 transition-colors last:border-0 hover:bg-accent/40">
```

That's it. Three edits, two files. Everything else "modern" about these
screens (colors, shadows, card radius) is already inherited from §1 with
zero further action — do not add anything beyond these three edits.

---

## 4. Groww/Sharekhan Data workspace — no changes needed

Audited and confirmed clean: it already has a page header (title +
description, matching the pattern used in §3a/§3b), composes existing
`CasImportScreen`/`ManualEquitiesScreen` components (which already inherit
§1's colors/shadows/card styling automatically), and has no hero money
figure to apply `.font-headline` to (it's a data-entry/import screen, not
a summary screen). **Do nothing to this workspace.**

---

## 5. Non-goals — do not do any of this

Read this before you start, not after. Every item here was deliberately
excluded, not overlooked.

1. **Do not add `.font-headline` anywhere not listed in §1d.**
   Specifically: Allocation and Alerts have no single headline figure
   (donuts/trend-chart/movers-list and a fired-alerts list, respectively)
   — do not invent one. Groww/Sharekhan Data is a form/import screen — same
   rule.
2. **Do not touch `dashboard/src/components/ui/card.tsx`,
   `button.tsx`, `badge.tsx`, or any other shared primitive** beyond what
   §1 already did. If you think one needs further changes, flag it in your
   report — don't change a shared primitive unilaterally; a change there
   affects every screen at once and needs a look at the actual rendered
   result across all of them, not just the one screen you're focused on.
3. **Do not touch `--chart-1`..`--chart-9`, `--primary`, `--background`,
   or any other token *value*** in `index.css` — already final for this
   round.
4. **Do not redesign layout, add components, change chart libraries
   (Recharts/ECharts/visx), or otherwise rebuild any screen's structure.**
   That is a categorically different, much larger kind of work — the
   Journey chart got exactly that treatment earlier via a full audit →
   three named directions → user picks one → spec → build cycle
   (`docs/JOURNEY_REDESIGN_HANDOFF.md`, `docs/design/spec-round3/`). If,
   while doing this task, you notice a screen that genuinely looks broken
   or dated the way Journey's old chart did (not "could look nicer" — an
   actual defect, like a broken control or unreadable overlapping text),
   **stop and write an audit note under `docs/design/audit/`** in the same
   format as `docs/design/audit/2026-08-27-journey-redesign-audit.md`. Do
   not fix it inline. The user explicitly wants to choose a direction
   before anything beyond this document's three mechanical edits gets
   built — that's why this document is this narrow instead of "go modernize
   everything, use your judgment."
5. **Do not touch `dashboard/src/types/contract.ts`, any Python file, or
   anything under `dashboard/public/data/`.** This task is three CSS-class
   / one-block-of-JSX changes across two `.tsx` files. If executing it
   seems to require touching anything else, stop — you've misunderstood
   the task, re-read §3.

---

## 6. Verification (all required before calling this done)

From `dashboard/`:

```sh
npm run typecheck
npm run lint
```

Both must be clean for the files you touched (`AlertsScreen.tsx`,
`AllocationScreen.tsx`). Pre-existing warnings/errors elsewhere in the repo
(e.g. `segments/`, `charts/options.ts`, `ui/chart-legend.tsx`) are known,
unrelated, and not yours to fix — don't let them block you, don't fix them
either.

Then, with `npm run dev` running, in a browser:

1. **Alerts tab**: confirm a page title ("Alerts") and one-line description
   now appear above the card. Hover over an individual fired alert row (if
   any are firing) and confirm a subtle background highlight appears,
   matching the hover feel of a Portfolio holdings-table row. Check the
   empty state (no alerts fired) still renders correctly below the new
   header.
2. **Allocation tab**: confirm a page title ("Allocation") and one-line
   description now appear above the donut charts.
3. Do both checks in **both** Light and Dark theme.
4. Confirm nothing else on either screen visually changed — donuts, trend
   chart, top movers, alert badges/severity colors all identical to
   before your edit.
5. `npm run check:contract` — should pass and be unaffected (nothing here
   touches the JSON contract); run it anyway as a safety net.

## 7. Commit

One commit, once §6 passes:

```
style(dashboard): add missing page headers + alert row hover state

Alerts and Allocation were the only two workspaces with no visible page
title, inconsistent with Journey/Portfolio/Properties/Groww-Sharekhan.
Alert rows now match the hover-state convention already used by the
Portfolio holdings table (hover:bg-accent/40). Colors/shadows/card
radius/headline typography were already modernized globally in
<commit-hash-of-todays-look-and-feel-commit> — see
docs/COLOR_TYPOGRAPHY_REFRESH_HANDOFF.md §1 for what that covered and
why these three edits were the only remaining gaps.
```

(Fill in the actual commit hash — `git log --oneline --all -- dashboard/src/index.css | head -5`.)

Do not push. Do not open a PR unless the user asks.
