/** Three allocation breakdowns — geography, platform, asset class — as
 *  segmented horizontal bars, not pie/donut charts, plus a fourth ECharts
 *  "Platform breakdown" card giving the absolute-₹ view behind the %s.
 *
 *  Part-to-whole is a bar job, not a pie job: comparing two slice ANGLES is
 *  much harder than comparing two bar LENGTHS, and a pie has nowhere to put
 *  a direct number without a separate legend anyway — so this skips straight
 *  to what the legend was already doing (one segmented bar for the shape of
 *  the whole, a labeled list for the exact numbers) instead of carrying a
 *  pie the reader has to cross-reference against it. (Ledger Gold redesign
 *  §3.2/§5 — the design brief assumed real donut/pie charts existed here;
 *  they never did, this file deliberately chose bars over pie before the
 *  redesign, so this pass keeps that decision and restyles it instead of
 *  introducing a pie chart, per the brief's own fallback clause.)
 *
 *  Every dimension sums to ~100% by construction (normalize/allocation.py).
 *  Category color is assigned by FIXED order (index -> --chart-N), never by
 *  value rank, so the same platform keeps the same color across renders.
 */

import { useMemo } from 'react'

import { EChart } from '@/components/charts/EChart'
import { categoryValueBarsOption, getChartPalette } from '@/components/charts/options'
import { formatInrCompact, platformLabel } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { Allocation, Latest } from '@/types/contract'

type NameValue = { name: string; value: number }

/** Raw allocation record -> { name, value } sorted by value desc (today's order). */
function toNameValue(record: Record<string, number> | undefined): NameValue[] {
  return Object.entries(record ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }))
}

function colorFor(index: number): string {
  return `var(--chart-${(index % 9) + 1})`
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

function BreakdownCard({
  title,
  data,
  index,
}: {
  title: string
  data: NameValue[]
  index: number
}) {
  return (
    <Card
      className="donut-enter flex flex-col shadow-sm"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        {data.length === 0 ? (
          <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
            No allocation data
          </div>
        ) : (
          <>
            {/* The bar — one segmented shape for the whole, 2px gaps between
                segments (never a seamless block a reader can't parse into parts). */}
            <div
              className="flex h-3 w-full overflow-hidden rounded-full"
              role="img"
              aria-label={`Allocation by ${title.toLowerCase().replace('by ', '')} — ${data
                .slice(0, 3)
                .map((d) => `${d.name} ${d.value.toFixed(1)}%`)
                .join(', ')}`}
              style={{ gap: '2px' }}
            >
              {data.map((d, i) => (
                <div
                  key={d.name}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${Math.max(d.value, 0.5)}%`, backgroundColor: colorFor(i) }}
                  title={`${d.name}: ${d.value.toFixed(1)}%`}
                />
              ))}
            </div>

            {/* The legend — the exact numbers, direct-labeled, never color-alone. */}
            <ul className="space-y-0.5">
              {data.map((d, i) => (
                <li
                  key={d.name}
                  className="-mx-1.5 flex items-center gap-2 rounded-sm px-1.5 py-1 text-xs transition-colors hover:bg-accent/40"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: colorFor(i) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={d.name}>
                    {d.name}
                  </span>
                  <span className="font-medium tabular-nums">{d.value.toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          </>
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
  }, [rows, masked])

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
