import { defineConfig } from '@playwright/test'

/**
 * E2E smoke + responsiveness harness for the M8 dashboard.
 *
 * - No `webServer` block: the Vite dev server is expected to already be
 *   running on 5174 (single process — `workers: 1` matches that).
 * - `channel: 'msedge'` reuses the installed Edge browser (no download).
 *   If the channel errors at runtime, remove the line to fall back to the
 *   bundled Chromium (`npx playwright install chromium`).
 */
export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1440, height: 900 },
    channel: 'msedge',
  },
  reporter: [['list']],
  workers: 1,
})