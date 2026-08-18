import { expect, test, type Page } from '@playwright/test'

/**
 * Smoke + responsiveness harness.
 *
 * Regression guard: the echarts-for-react CJS interop crash used to
 * white-screen the whole app; EChart.tsx now manages a raw echarts/core
 * instance. Every test collects console errors + page errors and asserts
 * they are empty, so any white-screen regression fails loudly.
 *
 * Rendering is deterministic: the app reads the static JSON exports
 * (public/data/*) — no network beyond those files and the health probe.
 */

type ConsoleIssues = { errors: string[]; pageErrors: string[] }

/** Collect console.error + uncaught page errors for the lifetime of the page. */
function watchConsole(page: Page): ConsoleIssues {
  const issues: ConsoleIssues = { errors: [], pageErrors: [] }
  page.on('console', (msg) => {
    if (msg.type() === 'error') issues.errors.push(msg.text())
  })
  page.on('pageerror', (err) => issues.pageErrors.push(err.message))
  return issues
}

function expectNoConsoleIssues(issues: ConsoleIssues) {
  expect(issues.errors, 'console.error calls').toEqual([])
  expect(issues.pageErrors, 'uncaught page errors').toEqual([])
}

/** The page itself must never overflow horizontally (tables scroll inside). */
async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(metrics.scrollWidth, 'page must not overflow horizontally').toBeLessThanOrEqual(
    metrics.innerWidth + 1,
  )
}

const SCREENS = [
  { tab: 'Overview', content: 'Total value' },
  { tab: 'India', content: 'platform filters + table' },
  { tab: 'US', content: 'Moomoo leg' },
  { tab: 'Returns', content: 'Portfolio simple return' },
  { tab: 'Alerts', content: 'Fired alerts' },
] as const

/**
 * Click through every tab, assert its expected content, open/close the chat
 * drawer, and (optionally) assert no horizontal page overflow after each
 * screen. Console issues are asserted at the end.
 */
async function visitAllScreens(page: Page, opts: { checkOverflow: boolean }) {
  const issues = watchConsole(page)

  await page.goto('/')
  for (const { tab, content } of SCREENS) {
    const tabLocator = page.getByRole('tab', { name: tab })
    await expect(tabLocator).toBeVisible()
    await tabLocator.click()
    if (content === 'platform filters + table') {
      await expect(page.getByRole('button', { name: 'Zerodha' })).toBeVisible()
      await expect(page.getByRole('table')).toBeVisible()
    } else {
      await expect(page.getByText(content)).toBeVisible()
    }
    if (opts.checkOverflow) await expectNoHorizontalOverflow(page)
  }

  // Chat drawer: opens as an in-flow side panel (sm+) or a fixed full-screen
  // takeover (mobile) — both must not overflow the page.
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await expect(page.getByText('Portfolio analyst')).toBeVisible()
  if (opts.checkOverflow) await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Close chat' }).click()
  await expect(page.getByText('Portfolio analyst')).not.toBeVisible()

  expectNoConsoleIssues(issues)
}

test('smoke: every screen renders with zero console errors (desktop)', async ({ page }) => {
  await visitAllScreens(page, { checkOverflow: false })
})

test.describe('responsive viewports — no horizontal overflow, no console errors', () => {
  const viewports = [
    { name: 'mobile', width: 375, height: 667 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ] as const

  for (const vp of viewports) {
    test.describe(`${vp.name} ${vp.width}x${vp.height}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } })

      test('all screens render without page overflow or console errors', async ({ page }) => {
        await visitAllScreens(page, { checkOverflow: true })
      })
    })
  }
})