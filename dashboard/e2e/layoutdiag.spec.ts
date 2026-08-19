import { test } from '@playwright/test'

test('layout diagnostic', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  // Inspect the top-level layout structure
  const info = await page.evaluate(() => {
    const out: any = {}
    const root = document.getElementById('root')
    out.rootChildren = root ? Array.from(root.children).map((e) => e.tagName) : []

    // Find the app shell container
    const app = document.querySelector('#root > div')
    if (app) {
      const cs = getComputedStyle(app)
      out.appShell = {
        display: cs.display,
        flexDirection: cs.flexDirection,
        height: cs.height,
        children: Array.from(app.children).map((c) => ({
          tag: c.tagName,
          className: (c as HTMLElement).className?.slice(0, 80),
          display: getComputedStyle(c as HTMLElement).display,
          height: getComputedStyle(c as HTMLElement).height,
        })),
      }
    }

    // Tabs present?
    const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map((t) => ({
      text: (t.textContent || '').trim().slice(0, 30),
      cls: (t as HTMLElement).className?.slice(0, 60),
      display: getComputedStyle(t as HTMLElement).display,
    }))
    out.tabs = tabs

    // The main three-pane row
    const row = document.querySelector('.flex.h-0.flex-1')
    out.mainRow = row ? {
      display: getComputedStyle(row).display,
      flexDirection: getComputedStyle(row).flexDirection,
      height: getComputedStyle(row).height,
      children: Array.from(row.children).map((c) => ({
        tag: c.tagName,
        cls: (c as HTMLElement).className?.slice(0, 60),
        width: getComputedStyle(c as HTMLElement).width,
      })),
    } : null

    // Any fixed-height overflow issues
    const body = document.body
    out.bodyOverflow = {
      scrollHeight: body.scrollHeight,
      innerHeight: window.innerHeight,
      scrollWidth: body.scrollWidth,
      innerWidth: window.innerWidth,
    }

    return out
  })

  console.log(JSON.stringify(info, null, 2))
})
