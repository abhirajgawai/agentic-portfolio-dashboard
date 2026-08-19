import { test } from '@playwright/test'

test('capture screenshots', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'test-results/shot-landing.png', fullPage: true })

  // Capture each workspace
  const workspaces = ['India', 'US', 'Returns', 'Alerts', 'Properties']
  for (const ws of workspaces) {
    await page.getByRole('tab', { name: ws }).click()
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `test-results/shot-${ws.toLowerCase()}.png`, fullPage: true })
  }

  // Go back to Journey
  await page.getByRole('tab', { name: 'Journey' }).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'test-results/shot-journey.png', fullPage: true })
})
