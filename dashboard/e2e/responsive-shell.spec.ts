import { expect, test } from '@playwright/test'

test('shell has no document horizontal overflow at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')

  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )).toBe(true)
  await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /chat/i })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Journey', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: /(?:show|hide) amounts/i })).toBeVisible()
  await expect(page.locator('footer[role="status"]')).toBeVisible()
  await expect(page.locator('footer[role="status"]')).toContainText(/Data .*platforms fresh/)
})

test('detailed health status rail is labelled when visible', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 800 })
  await page.goto('/')

  await expect(page.getByRole('group', { name: 'Detailed health status' })).toBeVisible()
})

test('Allocation remains reachable as the active workspace at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')

  const allocation = page.getByRole('button', { name: 'Allocation', exact: true })
  await expect(allocation).toBeVisible()
  await allocation.click()
  await expect(allocation).toHaveAttribute('aria-current', 'page')
})

test('opening chat does not create document overflow at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: /chat/i }).click()
  await expect(page.getByRole('complementary', { name: 'Portfolio analyst chat' })).toBeVisible()
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )).toBe(true)
})
