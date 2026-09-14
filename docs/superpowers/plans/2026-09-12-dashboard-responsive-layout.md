# Dashboard responsive layout implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make all dashboard workspaces responsive from a 360px phone viewport through wide desktop, beginning with the Allocation overflow shown in the screenshot.

**Architecture:** Put universal sizing and priority rules in the shared shell, then apply targeted, content-aware reflow to Allocation's mover rows, account roads, and chart labels. Audit each workspace for the same `min-w-0` / local-table-scroll contract, and prove no document-level overflow at representative viewports.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind CSS v4, ECharts, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-12-dashboard-responsive-layout-design.md`

## Global Constraints

- Support 360 CSS pixels as the mobile baseline; use the breakpoints defined in the spec.
- Never change dashboard data contracts, pipeline outputs, or the meaning of currency/return values.
- Document root must not horizontally scroll; tables alone may offer an explicit local scroller.
- Preserve keyboard access, reduced-motion behavior, and both color themes.
- Preserve concurrent work and stage only intentional files when committing.

---

### Task 1: Establish the shared responsive shell contract

**Files:**

- Modify: `dashboard/src/components/layout/AppShell.tsx`
- Modify: `dashboard/src/components/shell/WorkspaceCenter.tsx`
- Modify: `dashboard/src/components/layout/PageHeader.tsx`
- Modify: `dashboard/src/components/layout/HealthTicker.tsx`
- Modify: `dashboard/src/index.css`
- Test: `dashboard/e2e/responsive-shell.spec.ts`

**Interfaces:**

- Consumes: existing `AppShell`, workspace registry, header controls, and health data.
- Produces: a shrink-safe main content area, wrapping/priority-aware headers, and a mobile health-summary mode used by every workspace.

- [ ] **Step 1: Write a failing shell-overflow browser test.**

```ts
test('shell has no document horizontal overflow at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /chat/i })).toBeVisible()
})
```

- [ ] **Step 2: Run the test and confirm it fails against the current overflowing shell.**

Run: `npx playwright test e2e/responsive-shell.spec.ts`

The Playwright config intentionally uses its default Edge runner and declares no
named `chromium` project, so do not pass `--project=chromium`.

Expected: the width assertion fails on the current small viewport, or the test records the existing baseline failure if fixtures are unavailable.

- [ ] **Step 3: Add the minimum shell sizing rules.**

Use `min-w-0` on content-bearing flex/grid children, `w-full max-w-full` on the workspace viewport, 12px mobile padding, and `sm:p-4` desktop padding. Do not add root `overflow-x-hidden` as a substitute for fixing children. Make `PageHeader` mobile-first (`flex-col items-start`) and promote its current row layout at `sm`. Keep controls reachable via wrapping actions, not clipping.

```tsx
<header className="flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
  <div className="min-w-0">...</div>
  <div className="flex flex-wrap items-center gap-2">...</div>
</header>
```

- [ ] **Step 4: Make HealthTicker intentionally responsive.**

Render one concise, accessible freshness/health status on screens below `sm`; retain the full status stream from `sm` upward. If a full stream must remain available on mobile, contain it in an explicitly labelled inner `overflow-x-auto` rail, not the document body.

- [ ] **Step 5: Re-run the focused browser test and lint.**

Run: `npx playwright test e2e/responsive-shell.spec.ts`

Run: `npm run lint`

Expected: overflow assertion passes; header actions and a health signal are visible at 360px; no lint errors.

- [ ] **Step 6: Commit the shared shell change.**

```bash
git add dashboard/src/components/layout/AppShell.tsx dashboard/src/components/shell/WorkspaceCenter.tsx dashboard/src/components/layout/PageHeader.tsx dashboard/src/components/layout/HealthTicker.tsx dashboard/src/index.css dashboard/e2e/responsive-shell.spec.ts
git commit -m "fix(dashboard): make shared shell responsive"
```

### Task 2: Repair Allocation mover rows and account roads

**Files:**

- Modify: `dashboard/src/components/overview/AllocationScreen.tsx:18-61`
- Modify: `dashboard/src/components/journey/AccountRoads.tsx:85-107`
- Modify: `dashboard/src/components/overview/AllocationDonuts.tsx:217-300`
- Modify: `dashboard/src/components/charts/options.ts:568-620`
- Test: `dashboard/e2e/allocation-responsive.spec.ts`

**Interfaces:**

- Consumes: existing `usePerformance`, allocation data, `AccountRoads` history, and `categoryValueBarsOption`.
- Produces: mover rows that retain complete accessible names, readable phone account roads, and compact chart labels at mobile widths.

- [ ] **Step 1: Write a failing Allocation regression test with a long mutual-fund name.**

```ts
test('allocation long mover name stays inside its card at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/?workspace=allocation')
  const card = page.getByRole('heading', { name: /top losers/i }).locator('..')
  const row = card.getByTitle(/HDFC BSE Sensex Index Fund/i)
  await expect(row).toBeVisible()
  expect(await row.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true)
})
```

- [ ] **Step 2: Run the test and confirm the current row's overflow is caught.**

Run: `npx playwright test e2e/allocation-responsive.spec.ts --project=chromium`

Expected: the long-name row extends beyond its containing card or viewport before the fix.

- [ ] **Step 3: Rebuild mover rows as flexible identity plus fixed numeric zones.**

Keep ticker/name/platform in a `min-w-0 flex-1` region. Give the name `truncate` and `title={m.name}` with an accessible label carrying the complete value. Give percentage/amount spans `shrink-0 whitespace-nowrap`. Reflow the row to two lines below `sm`; preserve the compact single-line desktop presentation at `sm` and above.

```tsx
<div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center">
  <div className="min-w-0 flex-1 truncate" title={m.name}>{m.name}</div>
  <div className="shrink-0 whitespace-nowrap tabular-nums">{formatReturn(m)}</div>
</div>
```

- [ ] **Step 4: Make Allocation companions phone-readable.**

Hide `AccountRoads` decorative sparklines below `sm`, preserve label/value/change with a compact two-line layout, and apply `min-w-0` to donut card/legend children. Extend chart options with an explicit compact-label option driven by the caller; exact values must remain in the ECharts tooltip.

- [ ] **Step 5: Re-run Allocation regression coverage and theme checks.**

Run: `npx playwright test e2e/allocation-responsive.spec.ts --project=chromium`

Run: `npm run lint`

Expected: long gainers/losers do not escape at 360px; values align at desktop; no lint errors.

- [ ] **Step 6: Commit the Allocation repair.**

```bash
git add dashboard/src/components/overview/AllocationScreen.tsx dashboard/src/components/journey/AccountRoads.tsx dashboard/src/components/overview/AllocationDonuts.tsx dashboard/src/components/charts/options.ts dashboard/e2e/allocation-responsive.spec.ts
git commit -m "fix(dashboard): reflow allocation for narrow screens"
```

### Task 3: Apply the contract to remaining workspaces and local tables

**Files:**

- Modify: `dashboard/src/components/journey/JourneyWorkspace.tsx`
- Modify: `dashboard/src/components/portfolio/PortfolioScreen.tsx`
- Modify: `dashboard/src/components/alerts/AlertsScreen.tsx`
- Modify: `dashboard/src/components/holdings/PropertiesScreen.tsx`
- Modify: `dashboard/src/components/cas/CasImportScreen.tsx`
- Modify: `dashboard/src/components/performance/PerformanceScreen.tsx`
- Modify: `dashboard/src/components/segments/SegmentsScreen.tsx`
- Modify: `dashboard/src/components/holdings/HoldingsTable.tsx`
- Test: `dashboard/e2e/responsive-workspaces.spec.ts`

**Interfaces:**

- Consumes: each workspace's existing data hooks and shared cards/table component.
- Produces: mobile-first grids and explicit local table scrolling without changing workspace data or navigation behavior.

- [ ] **Step 1: Write failing parameterized viewport coverage for every workspace.**

```ts
for (const workspace of ['journey', 'portfolio', 'alerts', 'properties', 'cas', 'performance']) {
  test(`${workspace} has no document overflow at 360px`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto(`/?workspace=${workspace}`)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })
}
```

- [ ] **Step 2: Run the suite and list real failures by component.**

Run: `npx playwright test e2e/responsive-workspaces.spec.ts --project=chromium`

Expected: at least any currently overflowing workspace is identified before its layout is changed.

- [ ] **Step 3: Apply only component-local responsiveness fixes.**

For cards/grids use `grid-cols-1` as the base and promote columns only where a card has room. Add `min-w-0` to nested text flex children and wrap action groups. For `HoldingsTable`, preserve a visible, locally-scrolling table wrapper with a short scroll affordance; do not allow its width to determine body width.

- [ ] **Step 4: Re-run the workspace suite at phone, tablet, and desktop widths.**

Run: `npx playwright test e2e/responsive-workspaces.spec.ts --project=chromium --grep "360px"`

Run: `npx playwright test e2e/responsive-workspaces.spec.ts --project=chromium --grep "1024px|1440px"`

Expected: every workspace has a bounded document width and reachable primary controls at each tested width.

- [ ] **Step 5: Commit the cross-workspace consistency changes.**

```bash
git add dashboard/src/components/journey/JourneyWorkspace.tsx dashboard/src/components/portfolio/PortfolioScreen.tsx dashboard/src/components/alerts/AlertsScreen.tsx dashboard/src/components/holdings/PropertiesScreen.tsx dashboard/src/components/cas/CasImportScreen.tsx dashboard/src/components/performance/PerformanceScreen.tsx dashboard/src/components/segments/SegmentsScreen.tsx dashboard/src/components/holdings/HoldingsTable.tsx dashboard/e2e/responsive-workspaces.spec.ts
git commit -m "fix(dashboard): enforce responsive workspace layouts"
```

### Task 4: Complete the regression matrix and verify release quality

**Files:**

- Modify: `dashboard/e2e/responsive-shell.spec.ts`
- Modify: `dashboard/e2e/allocation-responsive.spec.ts`
- Modify: `dashboard/e2e/responsive-workspaces.spec.ts`
- Modify: `dashboard/README.md` (only if the local dashboard test command needs documentation)

**Interfaces:**

- Consumes: final responsive shell and workspace layouts.
- Produces: durable viewport coverage that detects root-level overflow and preserves intentional local table scroll.

- [ ] **Step 1: Add the full viewport/theme matrix.**

Use viewports 320, 360, 375, 480, 640, 768, 1024, 1280, 1440, and 1920. Run Allocation in light and dark themes, and test chat open/closed where the drawer changes usable width. Assert root width, card bounds, reachable controls, and chart bounds.

- [ ] **Step 2: Run browser regression and static verification.**

Run: `npx playwright test e2e/responsive-*.spec.ts --project=chromium`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run check:contract`

Expected: targeted browser tests, typecheck, lint, build, and contract check pass. If a known unrelated baseline failure remains, capture its exact file/error without weakening a responsive assertion.

- [ ] **Step 3: Review the diff at 100%, 125%, and 150% browser zoom.**

Confirm no document-level horizontal scrollbar, no text escapes its cards, all ECharts canvases resize, mobile footer/header controls remain reachable, and table scroll remains local and apparent.

- [ ] **Step 4: Commit verification assets and documentation.**

```bash
git add dashboard/e2e/responsive-shell.spec.ts dashboard/e2e/allocation-responsive.spec.ts dashboard/e2e/responsive-workspaces.spec.ts dashboard/README.md
git commit -m "test(dashboard): cover responsive viewport contract"
```
