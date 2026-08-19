import { expect, test } from '@playwright/test'

/**
 * Journey OS revamp verification — smoke test for the new three-pane shell.
 *
 * Verifies:
 *  - The page loads with ZERO console/page errors (no Vite error overlay,
 *    no missing imports, no runtime crashes).
 *  - The Journey workspace (default home) renders.
 *  - The workspace segmented control (Journey/India/US/Returns/Alerts/
 *    Properties) is present and switchable.
 *  - No horizontal page overflow (the three-pane shell must not break layout).
 */

const WORKSPACES = ['Journey', 'India', 'US', 'Returns', 'Alerts', 'Properties']

test('Journey OS: page loads with zero console errors and renders the shell', async ({ page }) => {
  const issues: { errors: string[]; pageErrors: string[] } = { errors: [], pageErrors: [] }
  page.on('console', (msg) => {
    if (msg.type() === 'error') issues.errors.push(msg.text())
  })
  page.on('pageerror', (err) => issues.pageErrors.push(err.message))

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // The Vite error overlay must NOT be present.
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)

  // The app root must have rendered content (not a white screen).
  await expect(page.locator('body')).not.toBeEmpty()

  // No uncaught page errors (the main "it works" signal).
  expect(issues.pageErrors, 'uncaught page errors').toEqual([])
  expect(issues.errors, 'console.error calls').toEqual([])
})

test('Journey OS: all 6 workspace modes are switchable and render', async ({ page }) => {
  const issues: { errors: string[]; pageErrors: string[] } = { errors: [], pageErrors: [] }
  page.on('console', (msg) => {
    if (msg.type() === 'error') issues.errors.push(msg.text())
  })
  page.on('pageerror', (err) => issues.pageErrors.push(err.message))

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // The segmented control should offer all 6 workspaces.
  for (const ws of WORKSPACES) {
    const tab = page.getByRole('tab', { name: ws })
    await expect(tab).toBeVisible()
  }

  // Switch to each workspace and assert the app didn't white-screen.
  for (const ws of WORKSPACES) {
    await page.getByRole('tab', { name: ws }).click()
    await expect(page.locator('body')).not.toBeEmpty()
  }

  expect(issues.pageErrors, 'uncaught page errors').toEqual([])
})

test('Journey OS: no horizontal overflow on desktop and mobile', async ({ page }) => {
  for (const vp of [
    { name: 'mobile', width: 375, height: 667 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(
      metrics.scrollWidth,
      `${vp.name} must not overflow horizontally`,
    ).toBeLessThanOrEqual(metrics.innerWidth + 1)
  }
})
