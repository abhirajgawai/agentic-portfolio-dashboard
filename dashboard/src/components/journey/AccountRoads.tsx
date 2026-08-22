/**
 * Account roads — mini trend lines (zerodha INR, moomoo SGD)
 * from history.byPlatform, the ledger's per-platform base-INR
 * series. Each road lazy-mounts via useInView (motion spec §9 — nothing
 * animates off-screen). shadcn/Recharts version — gradient areas, hidden axes,
 * custom tooltip, CSS entrance animations.
 *
 * Honesty: these are PLATFORM trends, not per-holding history — the contract
 * has no per-ticker series (rationale §3). Leading/trailing zero days (the
 * platform didn't run) are trimmed so a road never looks like it crashed to
 * zero; a platform with no non-zero day renders an explicit "no data yet".
 */

import { useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

import { useInView } from './useInView'
import { formatInrCompact, MASK_TEXT } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { ChartTooltipContent } from '@/components/ui/chart-tooltip'
import type { History } from '@/types/contract'

type RoadDef = { platform: string; label: string; currency: string }

const ROADS: ReadonlyArray<RoadDef> = [
  { platform: 'zerodha', label: 'Zerodha', currency: 'INR' },
  { platform: 'moomoo', label: 'Moomoo', currency: 'SGD' },
]

/** ChartConfig mapping platform keys to --chart-* CSS variables. */
const ROAD_CHART_CONFIG: ChartConfig = {
  zerodha: { label: 'Zerodha', color: 'var(--chart-1)' },
  moomoo: { label: 'Moomoo', color: 'var(--chart-2)' },
}

/** Trim leading + trailing non-running (zero) days from one platform series. */
function roadSeries(
  history: History,
  platform: string,
): { dates: string[]; values: number[] } {
  const all = history.byPlatform[platform] ?? []
  const start = all.findIndex((v) => v > 0)
  if (start === -1) return { dates: [], values: [] }
  let end = all.length - 1
  while (end > start && (all[end] ?? 0) === 0) end -= 1
  return {
    dates: history.dates.slice(start, end + 1),
    values: all.slice(start, end + 1),
  }
}

/** Gradient defs for the roads — injected into each chart's <defs>. */
function RoadGradientDefs({ platform }: { platform: string }) {
  const color = ROAD_CHART_CONFIG[platform]?.color ?? 'var(--chart-1)'
  const gradientId = `road${platform}Gradient`
  return (
    <defs>
      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor={color} stopOpacity={0.12} />
        <stop offset="95%" stopColor={color} stopOpacity={0} />
      </linearGradient>
    </defs>
  )
}

/** Custom tooltip formatter — mirrors the ECharts miniLineOption formatter. */
function roadTooltipFormatter(
  value: number | string | undefined,
  _name: string,
  _props: unknown,
  masked: boolean,
) {
  const num = typeof value === 'number' ? value : 0
  return masked ? MASK_TEXT : formatInrCompact(num)
}

/** Single road sparkline — AreaChart with gradient fill, hidden axes, custom tooltip. */
function RoadCard({
  def,
  history,
  index,
}: {
  def: RoadDef
  history: History
  index: number
}) {
  const { ref, inView } = useInView<HTMLDivElement>()
  const { masked } = usePrivacy()

  const series = useMemo(() => roadSeries(history, def.platform), [history, def.platform])
  const current = series.values.length > 0 ? (series.values[series.values.length - 1] ?? 0) : 0
  const hasValue = series.values.length > 0

  // Transform to Recharts data shape: [{ date: 'MM-DD', value: number }, ...]
  const data = useMemo(
    () =>
      series.dates.map((d, i) => ({
        date: d.slice(5), // 'YYYY-MM-DD' -> 'MM-DD'
        value: (series.values[i] as number) ?? 0,
      })),
    [series.dates, series.values],
  )

  const color = ROAD_CHART_CONFIG[def.platform]?.color ?? 'var(--chart-1)'
  const gradientId = `road${def.platform}Gradient`

  // Staggered animation delay: 100ms per road via CSS variable
  const staggerDelay = `${index * 100}ms`

  return (
    <div ref={ref} className="rounded-md border border-border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium">{def.label}</span>
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          {def.currency}
        </Badge>
      </div>
      <p className="mt-1 text-sm font-semibold tabular-nums">
        {masked ? MASK_TEXT : hasValue ? formatInrCompact(current) : "—"}
      </p>
      <div className="mt-1 h-10 w-full">
        {inView ? (
          series.values.length === 0 ? (
            <p className="pt-2.5 text-center text-[10px] text-muted-foreground">no data yet</p>
          ) : (
            <ChartContainer config={ROAD_CHART_CONFIG} className="h-10 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <RoadGradientDefs platform={def.platform} />
                  <defs>
                    <style
                      dangerouslySetInnerHTML={{
                        __html: `
                          @keyframes area-fade {
                            from { opacity: 0; }
                            to { opacity: 1; }
                          }
                          @keyframes line-draw {
                            from { stroke-dashoffset: var(--path-length); }
                            to { stroke-dashoffset: 0; }
                          }
                          @media (prefers-reduced-motion: reduce) {
                            .road-area,
                            .road-line {
                              animation-duration: 0.01ms !important;
                            }
                          }
                        `,
                      }}
                    />
                  </defs>
                  <XAxis
                    dataKey="date"
                    type="category"
                    axisLine={false}
                    tickLine={false}
                    tick={false}
                    tickMargin={0}
                    interval={0}
                  />
                  <YAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    tick={false}
                    domain={[0, 'auto']}
                  />
                  <Tooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name, props) => roadTooltipFormatter(value, name, props, masked)}
                        nameKey="date"
                        labelKey="value"
                      />
                    }
                    cursor={false}
                  />
                  <Area
                    className="road-area"
                    type="monotone"
                    dataKey="value"
                    stroke={color}
                    strokeWidth={2}
                    fill={`url(#${gradientId})`}
                    style={{
                      animation: `area-fade 600ms var(--ease-out) ${staggerDelay} forwards`,
                    } as React.CSSProperties}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          )
        ) : (
          <Skeleton className="h-10 w-full" />
        )}
      </div>
    </div>
  )
}

export function AccountRoads({ history }: { history: History }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold">Account roads</h3>
        <p className="text-[11px] text-muted-foreground">
          Platform trend in base INR — not per-holding
        </p>
        <div className="mt-3 space-y-2.5">
          {ROADS.map((def, index) => (
            <RoadCard key={def.platform} def={def} history={history} index={index} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}