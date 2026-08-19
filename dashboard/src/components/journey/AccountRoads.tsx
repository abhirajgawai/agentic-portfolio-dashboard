/**
 * Account roads — three mini trend lines (zerodha INR, moomoo SGD,
 * real_estate) from history.byPlatform, the ledger's per-platform base-INR
 * series. Each road lazy-mounts its ECharts instance via useInView (motion
 * spec §9 — nothing animates off-screen).
 *
 * Honesty: these are PLATFORM trends, not per-holding history — the contract
 * has no per-ticker series (rationale §3). Leading/trailing zero days (the
 * platform didn't run) are trimmed so a road never looks like it crashed to
 * zero; a platform with no non-zero day renders an explicit "no data yet".
 */

import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'

import { EChart } from '@/components/charts/EChart'
import { getChartPalette } from '@/components/charts/options'
import { useInView } from './useInView'
import { formatInrCompact, MASK_TEXT } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { History } from '@/types/contract'

type RoadDef = { platform: string; label: string; currency: string }

const ROADS: ReadonlyArray<RoadDef> = [
  { platform: 'zerodha', label: 'Zerodha', currency: 'INR' },
  { platform: 'moomoo', label: 'Moomoo', currency: 'SGD' },
  { platform: 'real_estate', label: 'Real estate', currency: 'INR' },
]

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

/** Sparse mini-line: no axes, no legend, just the curve + a per-road tooltip. */
function miniLineOption(opts: {
  dates: string[]
  values: number[]
  color: string
  masked: boolean
}): EChartsOption {
  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 0, right: 0, top: 2, bottom: 0 },
    xAxis: {
      type: 'category',
      show: false,
      boundaryGap: false,
      data: opts.dates.map((d) => d.slice(5)),
    },
    yAxis: { type: 'value', show: false, min: 'dataMin' },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20,20,24,0.92)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e8e8ea' },
      formatter: (params: unknown) => {
        const rows = params as Array<{ axisValue?: string; value?: number }>
        const row = rows[0]
        const value = typeof row?.value === 'number' ? row.value : 0
        const display = opts.masked ? MASK_TEXT : formatInrCompact(value)
        return `${row?.axisValue ?? ''}<br/><b>${display}</b>`
      },
    },
    series: [
      {
        name: opts.dates[0] ?? '',
        type: 'line',
        data: opts.values,
        smooth: 0.3,
        showSymbol: opts.values.length <= 8,
        symbolSize: 4,
        lineStyle: { width: 2, color: opts.color },
        itemStyle: { color: opts.color },
        areaStyle: { opacity: 0.12 },
      },
    ],
  }
}

function RoadCard({
  def,
  history,
  palette,
}: {
  def: RoadDef
  history: History
  palette: string[]
}) {
  const { ref, inView } = useInView<HTMLDivElement>()
  const { masked } = usePrivacy()

  const series = useMemo(() => roadSeries(history, def.platform), [history, def.platform])
  const colorIdx = ROADS.findIndex((r) => r.platform === def.platform)
  const color = palette[colorIdx % palette.length] ?? palette[0] ?? '#6f7cff'
  const current =
    series.values.length > 0 ? (series.values[series.values.length - 1] ?? 0) : null

  return (
    <div ref={ref} className="rounded-md border border-border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium">{def.label}</span>
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          {def.currency}
        </Badge>
      </div>
      <p className="mt-1 text-sm font-semibold tabular-nums">
        {masked ? MASK_TEXT : current === null ? '—' : formatInrCompact(current)}
      </p>
      <div className="mt-1 h-10 w-full">
        {inView ? (
          series.values.length === 0 ? (
            <p className="pt-2.5 text-center text-[10px] text-muted-foreground">no data yet</p>
          ) : (
            <EChart
              option={miniLineOption({
                dates: series.dates,
                values: series.values,
                color,
                masked,
              })}
              height={40}
            />
          )
        ) : (
          <Skeleton className="h-10 w-full" />
        )}
      </div>
    </div>
  )
}

export function AccountRoads({ history }: { history: History }) {
  const palette = useMemo(() => getChartPalette(), [])
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold">Account roads</h3>
        <p className="text-[11px] text-muted-foreground">
          Platform trend in base INR — not per-holding
        </p>
        <div className="mt-3 space-y-2.5">
          {ROADS.map((def) => (
            <RoadCard key={def.platform} def={def} history={history} palette={palette} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
