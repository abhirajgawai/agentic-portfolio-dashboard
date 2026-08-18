import { expect, test } from '@playwright/test'

/**
 * Privacy-toggle spec — the eye button in the top bar hides amounts and
 * quantities (display-only) while percentages and counts stay visible, and
 * the choice survives reloads via localStorage.
 *
 * Renders the static JSON exports (public/data/*) — no network beyond the
 * health probe, which fails gracefully (backend offline).
 */

/** The mask token — must match lib/format.ts MASK_TEXT. */
const MASK = '••••'

test('privacy toggle: hides amounts, keeps % + counts, persists across reload', async ({ page }) => {
  const issues: { errors: string[]; pageErrors: string[] } = { errors: [], pageErrors: [] }
  page.on('console', (msg) => {
    if (msg.type() === 'error') issues.errors.push(msg.text())
  })
  page.on('pageerror', (err) => issues.pageErrors.push(err.message))

  await page.goto('/')

  // Baseline: the total-value card shows a real ₹ figure and the toggle is
  // in the "Hide amounts" (visible) state.
  const eye = page.getByRole('button', { name: 'Hide amounts' })
  await expect(eye).toBeVisible()
  await expect(page.getByText(/₹\d/).first()).toBeVisible()
  await expect(page.getByText(MASK)).toHaveCount(0)

  // Click the toggle: amounts are replaced by the mask token.
  await eye.click()
  const show = page.getByRole('button', { name: 'Show amounts' })
  await expect(show).toBeVisible()
  await expect(page.getByText(/₹\d/)).toHaveCount(0)
  await expect(page.getByText(MASK).first()).toBeVisible()

  // Percentages stay visible: the "Simple return" card headline is a %.
  const simpleReturn = page.locator('div[data-slot="card"]').filter({ hasText: 'Simple return' })
  await expect(simpleReturn.getByText(/[+-]?\d+(\.\d+)?%/, { exact: true }).first()).toBeVisible()

  // Counts stay visible: the holdings-count text in the India header badge.
  await page.getByRole('tab', { name: 'India' }).click()
  await expect(page.getByText(/\d+ holdings/).first()).toBeVisible()
  // Table quantity/value cells are masked.
  await expect(page.getByRole('table').getByText(MASK).first()).toBeVisible()

  // State survives a reload (persisted in localStorage).
  await page.reload()
  await expect(page.getByRole('button', { name: 'Show amounts' })).toBeVisible()
  await expect(page.getByText(MASK).first()).toBeVisible()

  // Toggling back restores the numbers.
  await page.getByRole('button', { name: 'Show amounts' }).click()
  await expect(page.getByRole('button', { name: 'Hide amounts' })).toBeVisible()
  await expect(page.getByText(/₹\d/).first()).toBeVisible()

  expect(issues.errors, 'console.error calls').toEqual([])
  expect(issues.pageErrors, 'uncaught page errors').toEqual([])
})

test('privacy toggle: default state is visible (no stored preference)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Hide amounts' })).toBeVisible()
  await expect(page.getByText(/₹\d/).first()).toBeVisible()
})