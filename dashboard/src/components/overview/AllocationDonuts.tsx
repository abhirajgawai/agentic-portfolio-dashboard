/** Four allocation donuts — geography, platform, sector, asset class.
 *  Every dimension sums to ~100% by construction (normalize/allocation.py).
 *
 *  shadcn/Recharts donuts (Pie + Cell) replacing the ECharts donuts: CSS-token
 *  colors (light + dark), center overlay with the top slice share, custom DOM
 *  legend (all items rendered, scrollable container for long lists like sector).
 *  hover emphasis via activeShape (recharts 3.8 drives the active index from
 *  its tooltip state — no manual activeIndex).
 *
 *  ChartConfig keys are s0..sN — valid CSS identifiers (raw names like
 *  "Agri & Sugar" are not); ChartContainer turns them into --color-sN vars.
 */

import { useMemo, useState } from 'react'

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
} from 'recharts'
import type { PieSectorDataItem } from 'recharts'

import { usePrefersReducedMotion } from '@/components/journey/motion'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { ChartTooltipContent } from '@/components/ui/chart-tooltip'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { platformLabel } from '@/lib/format'
import type { Allocation } from '@/types/contract'

type NameValue = { name: string; value: number }
type SliceRow = { key: string; name: string; value: number; fill: string; color: string }

/** Raw allocation record -> { name, value } sorted by value desc (today's order). */
function toNameValue(record: Record<string, number> | undefined): NameValue[] {
  return Object.entries(record ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }))
}

/** Slice rows (s0..sN) + the ChartConfig mapping each key to a --chart-1..9 token. */
function buildSlices(data: NameValue[]): { slices: SliceRow[]; config: ChartConfig } {
  const slices: SliceRow[] = data.map((d, i) => ({
    key: `s${i}`,
    name: d.name,
    value: d.value,
    fill: `var(--color-s${i})`,
    color: `var(--chart-${(i % 9) + 1})`,
  }))
  const config: ChartConfig = {}
  for (let i = 0; i < data.length; i++) {
    config[`s${i}`] = {
      label: data[i]?.name ?? `s${i}`,
      color: `var(--chart-${(i % 9) + 1})`,
    }
  }
  return { slices, config }
}

/** Hover emphasis — active sector grows 4% and gets the ring stroke
 *  (ECharts emphasis.scaleSize parity; stroke matches both themes). */
function renderActiveShape(props: PieSectorDataItem) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={(outerRadius ?? 0) * 1.04}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      stroke="var(--ring)"
      strokeWidth={2}
    />
  )
}

/** Custom DOM legend — all rows rendered, wrapped in a scrollable container.
 *  No ChartLegend: Recharts' legend has no scroll and 32 rows would overflow.
 *  ~8 items visible before scroll (max-h-48 ≈ 12rem = 8 × row height).
 *  overscroll-contain prevents page scroll bleed when the legend reaches its end. */
function DonutLegend({ slices }: { slices: SliceRow[] }) {
  return (
    <div className="max-h-48 overflow-x-hidden overflow-y-auto overscroll-contain">
      <ul className="space-y-1">
        {slices.map((s) => (
          <li
            key={s.key}
            className="flex min-w-0 items-center gap-2 rounded-sm px-1.5 py-0.5 -mx-1.5 transition-colors hover:bg-accent/50"
          >
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: s.color }}
            />
            <span
              className="max-w-[140px] truncate text-xs text-muted-foreground"
              title={s.name}
            >
              {s.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DonutCard({
  title,
  data,
  index,
}: {
  title: string
  data: NameValue[]
  index: number
}) {
  const reduced = usePrefersReducedMotion()
  const [hovered, setHovered] = useState(false)
  const { slices, config } = useMemo(() => buildSlices(data), [data])
  const top = slices[0]

  const dimension = title.toLowerCase().replace('by ', '')
  const ariaLabel =
    slices.length === 0
      ? `Allocation by ${dimension}, no data`
      : `Allocation by ${dimension} — ${slices
          .slice(0, 3)
          .map((s) => `${s.name} ${s.value.toFixed(1)}%`)
          .join(', ')}`

  return (
    <Card
      className="donut-enter flex flex-col"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 items-center gap-3">
        {slices.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
            No allocation data
          </div>
        ) : (
          <>
            <div role="img" aria-label={ariaLabel} className="relative h-48 w-48 shrink-0">
              <ChartContainer config={config} className="h-full w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <Pie
                      data={slices}
                      dataKey="value"
                      nameKey="key"
                      cx="50%"
                      cy="50%"
                      innerRadius="52%"
                      outerRadius="78%"
                      stroke="none"
                      isAnimationActive={!reduced}
                      animationDuration={600}
                      animationEasing="ease-out"
                      activeShape={renderActiveShape}
                      onMouseEnter={() => setHovered(true)}
                      onMouseLeave={() => setHovered(false)}
                    >
                      {slices.map((s) => (
                        <Cell
                          key={s.key}
                          fill={s.fill}
                          stroke="var(--background)"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      content={
                        <ChartTooltipContent
                          nameKey="key"
                          hideLabel
                          formatter={(v) => `${Number(v).toFixed(1)}% of portfolio`}
                        />
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>
              </ChartContainer>
              {/* Center overlay — fades when tooltip is active to avoid overlap. */}
              <div className={`pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-150 ${hovered ? 'opacity-0' : 'opacity-100'}`}>
                <div className="text-center">
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {top ? `${top.value.toFixed(1)}%` : ''}
                  </p>
                  <p className="mx-auto max-w-[95%] text-[0.65rem] leading-tight text-muted-foreground">
                    {top?.name ?? ''}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <DonutLegend slices={slices} />
            </div>
          </>
        )}
        {/* sr-only full data — a donut can't be read; this is the info carrier. */}
        <ul className="sr-only">
          {slices.map((s) => (
            <li key={s.key}>{`${s.name}: ${s.value.toFixed(1)}% of portfolio`}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export function AllocationDonuts({ allocation }: { allocation: Allocation }) {
  return (
    <>
      {/* donut-enter keyframes — AccountRoads-style injected CSS; the global
          reduced-motion block plus this media query kill it for a11y. */}
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DonutCard index={0} title="By geography" data={toNameValue(allocation.byGeography)} />
        <DonutCard
          index={1}
          title="By platform"
          data={toNameValue(allocation.byPlatform).map((d) => ({
            ...d,
            name: platformLabel(d.name),
          }))}
        />
        <DonutCard index={2} title="By sector" data={toNameValue(allocation.bySector)} />
        <DonutCard
          index={3}
          title="By asset class"
          data={toNameValue(allocation.byAssetClass).map((d) => ({
            ...d,
            name: d.name.replaceAll('_', ' '),
          }))}
        />
      </div>
    </>
  )
}