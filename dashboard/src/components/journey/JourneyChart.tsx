/**
 * Hero journey chart — portfolio value over time from history.json with an
 * ECharts area series, gradient fill, per-goal markLines, milestone
 * markPoints, range pills (1M/3M/6M/1Y/All) and an inside dataZoom.
 *
 * Honesty: the series IS the EOD ledger (mixed-frequency — each date sums the
 * platforms that ran that day; nothing is interpolated). Goals are dashboard-
 * local (localStorage, see rationale §3), never ledger facts. The chart is
 * `role="img"` decoration per a11y-spec §5 — goals and milestones also render
 * as DOM list items in GoalMilestones / MilestoneJournal.
 */

import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'

import { EChart } from '@/components/charts/EChart'
import { dataZoomOption, getChartPalette, gradientFill } from '@/components/charts/options'
import { useTheme } from '@/lib/theme'
import { useGoals } from './goals'
import { useInView } from './useInView'
import { formatInrCompact, MASK_TEXT } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { History } from '@/types/contract'
import { usePrefersReducedMotion } from './motion'
import { deriveMilestones, formatShortDate, type Milestone } from './journal'

/* ------------------------------------------------------------------ */
/* Range pills                                                         */
/* ------------------------------------------------------------------ */

export type JourneyRange = '1M' | '3M' | '6M' | '1Y' | 'All'

const RANGES: ReadonlyArray<{ key: JourneyRange; days: number | null }> = [
  { key: '1M', days: 30 },
  { key: '3M', days: 91 },
  { key: '6M', days: 182 },
  { key: '1Y', days: 365 },
  { key: 'All', days: null },
]

/** Slice the ledger to the trailing window; "All" returns everything. */
function sliceHistory(history: History, range: JourneyRange): { dates: string[]; values: number[] } {
  const days = RANGES.find((r) => r.key === range)?.days ?? null
  const dates = history.dates
  if (days === null || dates.length === 0) {
    return { dates, values: history.portfolioValueBase }
  }
  const last = new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime()
  const threshold = new Date(last - days * 86_400_000).toISOString().slice(0, 10)
  const start = dates.findIndex((d) => d >= threshold)
  if (start <= 0) return { dates, values: history.portfolioValueBase }
  return {
    dates: dates.slice(start),
    values: history.portfolioValueBase.slice(start),
  }
}

/* ------------------------------------------------------------------ */
/* Theme-aware chart colors                                            */
/* ------------------------------------------------------------------ */

type ChartColors = {
  text: string
  axis: string
  tooltipBg: string
  tooltipText: string
  tooltipBorder: string
}

function themeColors(theme: 'light' | 'dark'): ChartColors {
  return theme === 'light'
    ? {
        text: '#5d5d66',
        axis: 'rgba(15,15,25,0.14)',
        tooltipBg: 'rgba(255,255,255,0.96)',
        tooltipText: '#27272a',
        tooltipBorder: 'rgba(15,15,25,0.12)',
      }
    : {
        text: '#9b9ba3',
        axis: 'rgba(255,255,255,0.08)',
        tooltipBg: 'rgba(20,20,24,0.92)',
        tooltipText: '#e8e8ea',
        tooltipBorder: 'rgba(255,255,255,0.1)',
      }
}

function effectiveTheme(theme: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

/** One markPoint per ledger index — crossings outrank appearances. */
function chartMilestones(history: History): Milestone[] {
  const byIndex = new Map<number, Milestone>()
  for (const milestone of deriveMilestones(history)) {
    const existing = byIndex.get(milestone.index)
    const isCrossing = milestone.description.startsWith('Crossed')
    if (!existing || (isCrossing && !existing.description.startsWith('Crossed'))) {
      byIndex.set(milestone.index, milestone)
    }
  }
  return [...byIndex.values()]
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function JourneyChart({ history }: { history: History }) {
  // lib/theme.tsx's useTheme is mid-refactor: it currently returns the raw
  // 'light'|'dark'|'system' string, while AppShell/Header destructure it as the
  // context object — the intended shape. Normalize defensively so this chart
  // compiles and colors correctly either way.
  const themeValue = useTheme()
  const theme = typeof themeValue === 'string' ? themeValue : themeValue.theme
  const { masked } = usePrivacy()
  const { goals } = useGoals()
  const reduced = usePrefersReducedMotion()
  const { ref, inView } = useInView<HTMLDivElement>()

  const [range, setRange] = useState<JourneyRange>('All')

  const palette = useMemo(getChartPalette, [])
  const isDark = effectiveTheme(theme) === 'dark'
  const sliced = useMemo(() => sliceHistory(history, range), [history, range])
  const milestones = useMemo(() => chartMilestones(history), [history])

  const option = useMemo<EChartsOption>(() => {
    const colors = themeColors(isDark ? 'dark' : 'light')
    const fmt = (value: number) => (masked ? MASK_TEXT : formatInrCompact(value))
    const mainColor = palette[0] ?? '#6f7cff'

    const dataMax = sliced.values.length > 0 ? Math.max(...sliced.values) : 0
    const goalMax = goals.reduce((max, g) => Math.max(max, g.targetAmount), 0)
    const msMax = milestones.reduce((max, m) => Math.max(max, m.value), 0)
    const yMax = Math.max(dataMax, goalMax, msMax) * 1.06 || undefined

    // Milestones inside the current window → markPoint pins.
    const pointData = milestones
      .map((m) => {
        const idx = sliced.dates.indexOf(m.date)
        if (idx === -1) return null
        return {
          name: m.description,
          coord: [idx, sliced.values[idx] ?? m.value],
          itemStyle: { color: '#e2b93d' },
          tooltip: { formatter: () => m.description },
        }
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)

    return {
      backgroundColor: 'transparent',
      animation: !reduced,
      animationDuration: 800,
      animationEasing: 'cubicOut',
      textStyle: { color: colors.text, fontFamily: 'inherit' },
      color: palette,
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.tooltipText },
        valueFormatter: (v: unknown) => fmt(typeof v === 'number' ? v : 0),
      },
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: sliced.dates.map((d) => d.slice(5)),
        axisLine: { lineStyle: { color: colors.axis } },
        axisLabel: { color: colors.text, fontSize: 11 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        max: yMax,
        axisLabel: { color: colors.text, fontSize: 11, formatter: (v: number) => fmt(v) },
        splitLine: { lineStyle: { color: colors.axis } },
      },
      // dataZoomOption() (shared charts/options) is typed `unknown[]`; the
      // useMemo<EChartsOption> body needs the ECharts component type here.
      dataZoom: dataZoomOption() as EChartsOption['dataZoom'],
      series: [
        {
          name: 'Portfolio',
          type: 'line',
          data: sliced.values,
          smooth: 0.3,
          symbol: 'circle',
          symbolSize: 6,
          showSymbol: sliced.values.length <= 12,
          lineStyle: { width: 2.5, color: mainColor },
          itemStyle: { color: mainColor },
          areaStyle: { color: gradientFill(mainColor) },
          markLine:
            goals.length > 0
              ? {
                  symbol: 'none',
                  silent: true,
                  label: {
                    fontSize: 10,
                    color: colors.text,
                    position: 'insideEndTop',
                    formatter: () => 'Goal',
                  },
                  data: goals.map((g) => ({
                    yAxis: g.targetAmount,
                    name: g.label,
                    lineStyle: { type: 'dashed', width: 1, color: g.color },
                    label: {
                      color: g.color,
                      formatter: () => `Goal: ${formatInrCompact(g.targetAmount)}`,
                    },
                  })),
                }
              : undefined,
          markPoint:
            pointData.length > 0
              ? {
                  symbol: 'pin',
                  symbolSize: 34,
                  label: { show: false },
                  data: pointData,
                }
              : undefined,
        },
      ],
    }
  }, [sliced, isDark, masked, goals, palette, milestones, reduced])

  const isEmpty = history.dates.length < 2
  const isShort = sliced.values.length < 2

  const firstDate = sliced.dates[0]
  const lastDate = sliced.dates[sliced.dates.length - 1]
  const firstValue = sliced.values[0] ?? 0
  const lastValue = sliced.values[sliced.values.length - 1] ?? 0
  const ariaLabel = masked
    ? `Net worth over time, ${sliced.dates.length} data points${
        firstDate && lastDate ? ` from ${formatShortDate(firstDate)} to ${formatShortDate(lastDate)}` : ''
      }`
    : `Net worth over time, from ${formatInrCompact(firstValue)} on ${
        firstDate ? formatShortDate(firstDate) : '—'
      } to ${formatInrCompact(lastValue)} on ${lastDate ? formatShortDate(lastDate) : '—'}`

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Journey</h3>
            <p className="text-[11px] text-muted-foreground">
              Net worth over time — EOD ledger (base currency)
            </p>
          </div>
          <div
            role="group"
            aria-label="Chart range"
            className="flex items-center gap-1 overflow-x-auto"
          >
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                aria-pressed={range === r.key}
                onClick={() => setRange(r.key)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  range === r.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {r.key}
              </button>
            ))}
          </div>
        </div>

        {isEmpty ? (
          <div className="flex h-80 items-center justify-center text-xs text-muted-foreground">
            No history yet — snapshots accumulate from the first pipeline run
          </div>
        ) : (
          <>
            {isShort && (
              <p className="mb-2 text-[11px] text-warning">
                Only {sliced.values.length} data point{sliced.values.length === 1 ? '' : 's'} in
                this range — the EOD ledger is mixed-frequency
              </p>
            )}
            <div ref={ref} role="img" aria-label={ariaLabel}>
              {inView ? (
                <EChart option={option} height={320} />
              ) : (
                <Skeleton className="h-80 w-full" />
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
