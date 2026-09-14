import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 360, height: 800 } })

test('Groww/Sharekhan Data sits beside Portfolio in primary navigation', async ({ page }) => {
  await page.goto('/')
  const primaryNavigation = page.getByRole('navigation', { name: 'Workspace navigation' })
  const groww = primaryNavigation.getByRole('button', { name: 'Groww/Sharekhan Data', exact: true })
  await expect(groww).toBeVisible()
  await expect(groww).not.toHaveAttribute('aria-current', 'page')
  await expect(primaryNavigation.getByRole('button', { name: 'Portfolio', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Manage workspaces' }).click()
  await expect(page.getByRole('menuitem', { name: 'Groww/Sharekhan Data', exact: true })).toHaveCount(0)
})

test('Alerts moves from the primary navigation into the keyboard-accessible Manage menu', async ({ page }) => {
  await page.goto('/')

  const primaryNavigation = page.getByRole('navigation', { name: 'Workspace navigation' })
  await expect(primaryNavigation.getByRole('button', { name: 'Alerts', exact: true })).toHaveCount(0)

  const manageTrigger = page.getByRole('button', { name: 'Manage workspaces' })
  await manageTrigger.focus()
  await page.keyboard.press('Enter')

  const alertsItem = page.getByRole('menuitem', { name: 'Alerts', exact: true })
  await expect(alertsItem).toBeVisible()
  await expect(alertsItem).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByText('Fired alerts')).toBeVisible()
  await expect(manageTrigger).toHaveAttribute('data-state', 'closed')

  await manageTrigger.click()
  await expect(page.getByRole('menuitem', { name: 'Alerts', exact: true })).toHaveAttribute('aria-current', 'page')
})
