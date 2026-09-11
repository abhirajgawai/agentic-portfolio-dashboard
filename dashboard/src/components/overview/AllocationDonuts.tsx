/** Three allocation breakdowns — geography, platform, asset class — as real
 *  ECharts donut rings (design brief §3.2 "keep asset-class/venue/currency
 *  donuts", §5 "reuse the existing ECharts investment") with a direct-number
 *  legend beside each ring, plus a fourth ECharts "Platform breakdown" card
 *  giving the absolute-₹ view behind the %s.
 *
 *  The donut is the at-a-glance shape of the whole; the legend beside it is
 *  the exact numbers, direct-labeled, never color-alone (comparing two slice
 *  ANGLES is still harder than reading a number off a list, so the legend
 *  carries the precision the ring can't).
 *
 *  Every dimension sums to ~100% by construction (normalize/allocation.py).
 *  Category color is assigned by FIXED order (index -> --chart-N), never by
 *  value rank, so the same platform keeps the same color across renders.
 *  The donut's per-slice colors must be RESOLVED concrete values (see
 *  getChartPalette() in options.ts) — ECharts renders to a <canvas>, which
 *  can't resolve `var(--chart-N)` the way the legend's HTML dots can.
 */

import { useMemo } from 'react'

import { EChart } from '@/components/charts/EChart'
import { categoryValueBarsOption, donutOption, getChartPalette, resolveThemeColor } from '@/components/charts/options'
import { formatInrCompact, platformLabel } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { useTheme } from '@/lib/theme'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { Allocation, Latest } from '@/types/contract'

/** `id` is the raw, pre-label key (e.g. platform id `zerodha`) — kept
 *  alongside the display `name` so a color resolver can key off the stable
 *  raw value even after `name` has been through platformLabel() or similar. */
type NameValue = { name: string; value: number; id: string }

/** Raw allocation record -> { name, value, id } sorted by value desc (today's order). */
function toNameValue(record: Record<string, number> | undefined): NameValue[] {
  return Object.entries(record ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value, id: name }))
}

function colorFor(index: number): string {
  return `var(--chart-${(index % 9) + 1})`
}

/** Default coloring: by value rank (the order `data` is already sorted in) —
 *  used by the by-geography and by-asset-class donuts, which have no fixed
 *  category -> color mapping. */
function rankColorIndex(_item: NameValue, index: number): number {
  return index
}

/** Same fixed platform -> chart-N mapping as AccountRoads, so a platform's
 *  color reads consistently between the bars card below and the full
 *  Account roads section beneath it. Index into getChartPalette() rather than
 *  a raw `var(--chart-N)` string — ECharts renders to a <canvas>, which can't
 *  resolve CSS custom properties the way DOM elements can, so the palette
 *  needs to be resolved to concrete color values up front. */
const PLATFORM_CHART_INDEX: Record<string, number> = {
  zerodha: 0,
  moomoo: 1,
  groww: 2,
  sharekhan: 3,
  real_estate: 4,
}

/** By-platform card only: color by the FIXED platform id (via `item.id`,
 *  the pre-platformLabel() raw value), not value rank — otherwise the same
 *  platform can render a different color here than in the bars card /
 *  Account Roads below, which both use PLATFORM_CHART_INDEX. */
function platformColorIndex(item: NameValue): number {
  return PLATFORM_CHART_INDEX[item.id] ?? 0
}

function BreakdownCard({
  title,
  data,
  index,
  colorIndex = rankColorIndex,
}: {
  title: string
  data: NameValue[]
  index: number
  /** Maps a data item to a palette/chart-N index. Defaults to rank order;
   *  the by-platform card overrides this with platformColorIndex so its
   *  colors agree with the bars/Account-Roads cards on the same page. */
  colorIndex?: (item: NameValue, index: number) => number
}) {
  const { resolvedTheme } = useTheme()
  const option = useMemo(() => {
    const palette = getChartPalette()
    return donutOption({
      labels: data.map((d) => d.name),
      values: data.map((d) => d.value),
      colors: data.map((d, i) => palette[colorIndex(d, i) % palette.length] ?? '#6f7cff'),
      borderColor: resolveThemeColor('--card', '#ffffff'),
    })
    // resolvedTheme isn't read directly here, but getChartPalette()/
    // resolveThemeColor() read live CSS custom properties off <html> — this
    // dep is what makes the memo re-run (and the canvas re-paint) when the
    // theme toggles, instead of keeping stale colors until an unrelated
    // re-render happens to fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, colorIndex, resolvedTheme])

  return (
    <Card
      className="donut-enter flex flex-col shadow-sm"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        {data.length === 0 ? (
          <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
            No allocation data
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {/* The ring — the at-a-glance shape of the whole. Exact numbers
                live in the legend beside it, never color-alone. */}
            <div
              className="w-[104px] shrink-0"
              role="img"
              aria-label={`Allocation by ${title.toLowerCase().replace('by ', '')} — ${data
                .slice(0, 3)
                .map((d) => `${d.name} ${d.value.toFixed(1)}%`)
                .join(', ')}`}
            >
              <EChart option={option} height={104} />
            </div>

            {/* The legend — the exact numbers, direct-labeled, never color-alone. */}
            <ul className="min-w-0 flex-1 space-y-0.5">
              {data.map((d, i) => (
                <li
                  key={d.name}
                  className="-mx-1.5 flex items-center gap-2 rounded-sm px-1.5 py-1 text-xs transition-colors hover:bg-accent/40"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: colorFor(colorIndex(d, i)) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={d.name}>
                    {d.name}
                  </span>
                  <span className="font-medium tabular-nums">{d.value.toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Absolute-₹ companion to the "By platform" % card above — a horizontal
 *  ECharts bar per platform (design brief §3.2's "horizontal-bar breakdown
 *  card"), colored with the same fixed platform palette AccountRoads uses
 *  below it. Derived straight from holdings.valueBase (not allocation.byPlatform,
 *  which is a percentage) so the numbers are exact, not %-of-total rounding. */
function PlatformBreakdownBars({ holdings }: { holdings: Latest['holdings'] }) {
  const { masked } = usePrivacy()
  const { resolvedTheme } = useTheme()

  const rows = useMemo(
    () =>
      Object.entries(
        holdings.reduce<Record<string, number>>((acc, h) => {
          acc[h.platform] = (acc[h.platform] ?? 0) + h.valueBase
          return acc
        }, {}),
      )
        .sort((a, b) => b[1] - a[1])
        .map(([platform, value]) => ({ platform, value })),
    [holdings],
  )

  const option = useMemo(() => {
    const palette = getChartPalette()
    return categoryValueBarsOption({
      labels: rows.map((r) => platformLabel(r.platform)),
      values: rows.map((r) => r.value),
      colors: rows.map((r) => palette[PLATFORM_CHART_INDEX[r.platform] ?? 0] ?? palette[0] ?? '#6f7cff'),
      formatter: (v) => formatInrCompact(v),
      masked,
    })
    // resolvedTheme forces a re-paint on theme toggle — see the comment on
    // BreakdownCard's option memo above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, masked, resolvedTheme])

  return (
    <Card className="donut-enter shadow-sm" style={{ animationDelay: '240ms' }}>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-semibold">Platform breakdown</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Current value by platform (base INR) — the ₹ amounts behind the "By platform" %
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
            No holdings yet
          </div>
        ) : (
          <EChart option={option} height={Math.max(rows.length * 36, 90)} />
        )}
      </CardContent>
    </Card>
  )
}

export function AllocationDonuts({
  allocation,
  holdings,
}: {
  allocation: Allocation
  holdings: Latest['holdings']
}) {
  return (
    <>
      <style>{`
        @keyframes donut-enter {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .donut-enter {
          animation: donut-enter 400ms var(--ease-out) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .donut-enter {
            animation: none !important;
          }
        }
      `}</style>
      <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3')}>
        <BreakdownCard index={0} title="By geography" data={toNameValue(allocation.byGeography)} />
        <BreakdownCard
          index={1}
          title="By platform"
          data={toNameValue(allocation.byPlatform).map((d) => ({
            ...d,
            name: platformLabel(d.name),
          }))}
          colorIndex={platformColorIndex}
        />
        <BreakdownCard
          index={2}
          title="By asset class"
          data={toNameValue(allocation.byAssetClass).map((d) => ({
            ...d,
            name: d.name.replaceAll('_', ' '),
          }))}
        />
      </div>
      <div className="mt-4">
        <PlatformBreakdownBars holdings={holdings} />
      </div>
    </>
  )
}
