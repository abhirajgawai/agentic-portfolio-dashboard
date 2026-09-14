import { expect, test } from '@playwright/test'

test('allocation long mover name stays inside its card at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Allocation', exact: true }).click()

  const longName = /HDFC BSE Sensex Index Fund/i
  const losersCard = page
    .getByRole('heading', { name: /top losers/i })
    .locator('xpath=ancestor::*[@data-slot="card"][1]')
  const moverName = page.getByTitle(longName).first()
  await expect(losersCard).toBeVisible()
  await expect(moverName).toBeVisible()
  await expect(moverName).toHaveAttribute('aria-label', longName)

  const row = moverName.locator('xpath=ancestor::div[contains(@class, "rounded-md")][1]')
  await expect(row).toBeVisible()
  const [rowRight, cardRight] = await Promise.all([
    row.evaluate((element) => element.getBoundingClientRect().right),
    losersCard.evaluate((element) => element.getBoundingClientRect().right),
  ])
  expect(rowRight).toBeLessThanOrEqual(cardRight + 1)
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )).toBe(true)
})
