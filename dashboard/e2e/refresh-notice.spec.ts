/**
 * refresh-notice.spec.ts — verifies the "last refresh" footer label and the
 * "new data generated — reload" banner (RefreshNotice).
 *
 * Fast and environment-light: it does NOT trigger a full pipeline run. The
 * background-export signal is synthesized by running `export_json.py` directly
 * (a DB-backed JSON rewrite, ~3s, brokers not involved) so the bridge's
 * exportsGeneratedAt stamp advances, exactly like a scheduled export landing.
 *
 * Precondition (see playwright.config.ts — no webServer): Vite is already on
 * :5174 AND the bridge is already on :8001 (the dashboard/proxy must be up).
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { test, expect, type Page } from '@playwright/test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const py = path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
const exportScript = path.join(repoRoot, 'scripts', 'export_json.py')

const BANNER = /New data generated at/

/** Regenerate the 5 JSON exports (deterministic). Bumps file mtimes so the
 *  bridge's exportsGeneratedAt stamp advances -> the 10s health poll trips the
 *  banner, exactly like a scheduled export landing while the tab is open. */
function advanceStamp() {
  execFileSync(py, [exportScript], { cwd: repoRoot, stdio: 'ignore', timeout: 20_000 })
}

test('footer shows last-refresh stamp and banner fires on a background export advance', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // (1) "Last refresh" label is rendered (live from the bridge health poll).
  await expect(page.getByText(/Last refresh/i)).toBeVisible()

  // (2) No reload banner on initial load (baseline == current stamp).
  await expect(page.getByText(BANNER)).toHaveCount(0)

  // (3) A background export advance -> banner appears + reload button works.
  advanceStamp()
  await expect(page.getByText(BANNER)).toBeVisible(undefined, { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()

  // (4) Dismiss -> banner hidden; another advance re-arms it (re-fire on next change).
  await page.getByRole('button', { name: /Dismiss new data notice/i }).click()
  await expect(page.getByText(BANNER)).toHaveCount(0)
  advanceStamp()
  await expect(page.getByText(BANNER)).toBeVisible(undefined, { timeout: 15_000 })
})
