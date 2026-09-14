# Dashboard responsive layout design

## Purpose

Make every dashboard workspace usable from a 360 CSS-pixel phone viewport
(including the user's Samsung S26-class handset) through a wide desktop. The
dashboard must not produce document-level horizontal scrolling. This is a
presentation-only M8 change: data contracts, deterministic exports, and chart
data remain untouched.

## Evidence

The Allocation screenshot's overflowing loss rows come from
`dashboard/src/components/overview/AllocationScreen.tsx`: the fund-name
element uses `ml-auto whitespace-nowrap`, so a long mutual-fund name cannot
shrink inside a two-column card. The intended fix is a shrinking identity
region plus a non-shrinking numeric region, rather than hiding overflow.

Related audit findings:

- `HealthTicker.tsx` is a single non-wrapping desktop stream that clips useful
  status on narrow screens.
- `AccountRoads.tsx` reserves fixed sparkline and numeric rails that crowd
  labels on phones.
- `PageHeader.tsx`, nested grid/flex children, and chart gutters need a shared
  responsive contract so the same overflow does not reappear elsewhere.

## Responsive contract

| Width | Layout behavior |
| --- | --- |
| 320–479px | One column; 12px content gutters; compact header/footer; rows reflow; decorative sparklines hidden. |
| 480–639px | One column; long metadata may truncate but never escape its card. |
| 640–1023px | Two columns only when each card has at least roughly 300px; actions wrap. |
| 1024–1279px | Desktop two-column workspace layouts and account-road decoration permitted. |
| 1280px+ | Existing dense desktop layouts return; extra width grows the main content without creating a blank right rail. |

Every flex/grid child that contains unbounded user data must be allowed to
shrink (`min-w-0`). Human-readable names either wrap deliberately or truncate
with `title` and an accessible full label. Numeric values stay visually aligned
and must not be truncated. Horizontal scrolling is allowed only inside an
explicit table/code scroller, never at document root.

## Component behavior

### Shared shell

- Keep the app/content width shrinkable; use controlled horizontal containment
  only as a guard after fixing child sizing.
- Header actions and page-header actions stack/wrap on narrow screens while the
  active workspace remains reachable.
- Health ticker uses a concise mobile health summary; tablet and desktop retain
  the complete status stream.

### Allocation

- Top Gainers/Losers rows become two responsive zones: a flexible identity
  zone (ticker/name/platform) and a fixed numeric zone (return/amount). On
  phone widths the zones may reflow onto two lines; at larger widths they stay
  compact on one line.
- Allocation cards stay single-column until cards have room; donut legends use
  shrink/truncation rules.
- Account roads hide decorative sparklines below the small breakpoint and
  preserve readable label/value/change information.
- Canvas chart options use compact mobile labels; exact amounts remain in the
  tooltip or companion list.

### Other workspaces

- Audit Journey, Portfolio, Alerts, Properties, CAS, Performance, and segment
  views for the shared contract: mobile-first grids, `min-w-0` nested children,
  wrapping action bars, and explicit local table scrolling.
- No API, schema, formatter semantics, or source-data behavior changes.

## Verification

Add or repair a browser regression matrix at 320, 360, 375, 480, 640, 768,
1024, 1280, 1440, and 1920 CSS pixels in both themes. It must assert:

1. `document.documentElement.scrollWidth <= window.innerWidth + 1` outside
   explicit table scrollers.
2. Allocation's long fund-name case remains inside its mover card; its full
   name is exposed through `title`/accessible text.
3. Header controls, workspace tabs, refresh/chat/privacy actions, and a health
   indicator remain reachable at 360px.
4. Charts resize into their containers and retain tooltip access to exact
   values.
5. Keyboard focus and reduced-motion behavior remain intact.

Run dashboard typecheck, lint, build, contract checks, and the targeted browser
tests. Existing unrelated baseline failures must be reported separately rather
than masked.
