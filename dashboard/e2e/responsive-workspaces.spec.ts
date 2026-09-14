import { expect, test, type Page } from '@playwright/test'

const workspaces = ['journey', 'allocation', 'portfolio', 'alerts', 'properties', 'groww-sharekhan'] as const
const viewports = [
  { label: '320px', width: 320, height: 800 },
  { label: '360px', width: 360, height: 800 },
  { label: '375px', width: 375, height: 800 },
  { label: '480px', width: 480, height: 800 },
  { label: '640px', width: 640, height: 800 },
  { label: '768px', width: 768, height: 900 },
  { label: '1024px', width: 1024, height: 900 },
  { label: '1280px', width: 1280, height: 900 },
  { label: '1440px', width: 1440, height: 900 },
  { label: '1920px', width: 1920, height: 900 },
] as const

async function openWorkspace(page: Page, workspace: (typeof workspaces)[number]) {
  await page.goto('/')
  if (workspace === 'journey' || workspace === 'allocation' || workspace === 'portfolio') {
    await page.getByRole('button', { name: workspace[0].toUpperCase() + workspace.slice(1), exact: true }).click()
    return
  }

  await page.getByRole('button', { name: 'Manage workspaces' }).click()
  const label = workspace === 'groww-sharekhan' ? 'Groww/Sharekhan Data' : 'Properties'
  await page.getByRole('menuitem', { name: workspace === 'alerts' ? 'Alerts' : label, exact: true }).click()
}

for (const workspace of workspaces) {
  for (const viewport of viewports) {
    test(`${workspace} has no document overflow at ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await openWorkspace(page, workspace)

      const relevantControl = workspace === 'journey' || workspace === 'allocation' || workspace === 'portfolio'
        ? page.getByRole('button', { name: workspace[0].toUpperCase() + workspace.slice(1), exact: true })
        : page.getByRole('button', { name: 'Manage workspaces' })
      await expect(relevantControl).toBeVisible()

      await expect.poll(() => page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      )).toBe(true)
    })
  }
}

test('holdings table keeps horizontal scrolling local at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await openWorkspace(page, 'portfolio')

  const scroller = page.getByTestId('holdings-table-scroll')
  await expect(scroller).toBeVisible()
  await expect.poll(() => scroller.evaluate((element) => getComputedStyle(element).overflowX)).toBe('auto')
  await expect.poll(() => scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  await scroller.evaluate((element) => { element.scrollLeft = 32 })
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft > 0)).toBe(true)
  await expect(page.getByText('Scroll table →')).toBeVisible()
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )).toBe(true)
})

for (const screen of ['cas', 'performance', 'segments'] as const) {
  test(`${screen} test harness has no document overflow at 360px`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto(`/e2e/workspace-harness.html?screen=${screen}`)

    // The harness intentionally has no bridge/API mock. Assert its mounted
    // shell, then measure the settled layout rather than waiting for live
    // screen-specific data that may be unavailable in a local test run.
    await expect(page.locator('main')).toBeVisible()
    await page.waitForTimeout(250)

    await expect.poll(() => page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    )).toBe(true)
  })
}
