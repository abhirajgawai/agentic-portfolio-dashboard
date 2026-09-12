/**
 * Shared ECharts option builders — one dark, theme-consistent look for every
 * chart (trend area, return bars, performance). Kept here so screens stay thin
 * and the palette lives in ONE place (the M9 swap touches nothing chart-related).
 * The allocation donuts moved to shadcn/Recharts (AllocationDonuts) in M8.7.
 */

import type { EChartsOption } from 'echarts'

import { MASK_TEXT } from '@/lib/format'

/**
 * Theme-resolved chart colors. Charts render to a <canvas>, which can't
 * resolve `var(--foo)` the way DOM elements can, so these read the CURRENT
 * computed CSS custom property off `:root`/`.dark` (see resolveThemeColor()
 * below) each time an option builder runs — never hardcode a hex/rgba here.
 * Fallbacks match this repo's light-mode tokens (index.css `:root`).
 */
function chartText(): string {
  return resolveThemeColor('--muted-foreground', 'oklch(0.48 0.02 60)')
}
function axisLine(): string {
  return resolveThemeColor('--border', 'oklch(0.9 0.014 70)')
}
function tooltipTheme(): { backgroundColor: string; borderColor: string; textStyle: { color: string } } {
  return {
    backgroundColor: resolveThemeColor('--card', '#ffffff'),
    borderColor: resolveThemeColor('--border', 'oklch(0.9 0.014 70)'),
    textStyle: { color: resolveThemeColor('--foreground', 'oklch(0.22 0.018 58)') },
  }
}

/** Categorical palette (mirrors the --chart-* tokens in index.css) — the
 *  static-import-time fallback for canvas gradients/series colors. Theme-aware
 *  callers should prefer getChartPalette(), which resolves the live --chart-N
 *  custom properties. */
export const CATEGORY_COLORS = [
  '#6f7cff', // chart-1 indigo
  '#63d6a5', // chart-2 green
  '#e2b93d', // chart-3 amber
  '#d0655e', // chart-4 red
  '#c48fd8', // chart-5 violet
  '#4fb3d9', // cyan
  '#e88db4', // pink
  '#8fbf5f', // lime
  '#d9a05b', // orange
  '#7a8ea6', // slate
]

export const GAIN = '#63d6a5'
export const LOSS = '#d0655e'

/** Value-over-time area chart (portfolio total + geography lines). */
export function trendAreaOption(opts: {
  dates: string[]
  series: Array<{ name: string; data: number[]; area?: boolean }>
  formatter?: (value: number) => string
  /** When true, currency labels (tooltip + y-axis) render as MASK_TEXT.
   *  The curve itself stays visible — only the numbers are hidden. */
  masked?: boolean
  /** Direct value labels on the FIRST series (Option A: read the number off
   *  the chart, not off a hover tooltip). Caller gates this on point count —
   *  labels collide once there are more than a handful of points. */
  showLabels?: boolean
  /** Per-series colors, in `series` order. Defaults to the resolved
   *  `--chart-1..9` palette (getChartPalette()) rather than the hardcoded
   *  CATEGORY_COLORS fallback, so this stays token-consistent with every
   *  other themed chart on the page. */
  colors?: string[]
  /** Horizontal goal line(s), drawn on the FIRST series (the one with the
   *  area fill) so they sit against the headline total, not a breakdown line. */
  goalLines?: Array<{ value: number; label: string }>
}): EChartsOption {
  const fmt = opts.formatter ?? ((v: number) => String(v))
  const valueFmt = (v: number) => (opts.masked ? MASK_TEXT : fmt(v))
  const goalMarkLine =
    opts.goalLines?.length
      ? ({
          silent: true,
          symbol: 'none',
          lineStyle: { color: resolveThemeColor('--warning', 'oklch(0.62 0.15 85)'), type: 'dashed' as const, width: 1.5 },
          label: { formatter: (p: { data?: { label?: string } }) => p.data?.label ?? '', color: resolveThemeColor('--warning', 'oklch(0.62 0.15 85)'), fontSize: 10, position: 'insideEndTop' as const },
          data: opts.goalLines.map((g) => ({ yAxis: g.value, label: { formatter: g.label } })),
        } as unknown as EChartsOption['series'])
      : undefined
  return {
    backgroundColor: 'transparent',
    textStyle: { color: chartText(), fontFamily: 'inherit' },
    color: opts.colors ?? getChartPalette(),
    tooltip: {
      trigger: 'axis',
      ...tooltipTheme(),
      valueFormatter: (v: unknown) => valueFmt(typeof v === 'number' ? v : 0),
    },
    grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: opts.dates.map((d) => d.slice(5)), // MM-DD tick labels
      axisLine: { lineStyle: { color: axisLine() } },
      axisLabel: { color: chartText(), fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: chartText(),
        fontSize: 11,
        formatter: (v: number) => valueFmt(v),
      },
      splitLine: { lineStyle: { color: axisLine() } },
    },
    legend: {
      top: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 10,
      icon: 'circle',
      textStyle: { color: chartText(), fontSize: 11 },
    },
    series: opts.series.map((s, i) => ({
      name: s.name,
      type: 'line' as const,
      data: s.data,
      smooth: 0.3,
      symbol: 'circle',
      symbolSize: 5,
      showSymbol: opts.showLabels && i === 0,
      lineStyle: { width: 2 },
      areaStyle: s.area ? { opacity: 0.18 } : undefined,
      // Labels on the first (Portfolio) series only — avoids collisions
      // when geography lines are drawn alongside it.
      label:
        opts.showLabels && i === 0 && !opts.masked
          ? {
              show: true,
              position: 'top' as const,
              fontSize: 11,
              fontWeight: 600 as const,
              color: chartText(),
              formatter: (p: { value: number }) => fmt(p.value),
            }
          : { show: false },
      markLine: i === 0 ? goalMarkLine : undefined,
    })) as EChartsOption['series'],
  }
}

/**
 * Journey chart — net worth over time, by platform (Ledger Gold redesign).
 * Plain lines, no area fill — a first pass used a stacked area (solid color
 * fields), which read as too heavy against the warm ivory/gold surface; thin
 * lines let the background carry the page and only the line color carries
 * identity. The Total line is bold and in the brand accent (the headline
 * read); platform lines are thinner context, each colored via
 * `opts.colorIndex`, keyed on the SAME `PLATFORM_CHART_INDEX` map Allocation/
 * Account Roads use, so a platform's line here is the same color as its bar/
 * road elsewhere in the app. Straight segments, not smoothed — a snapshot is
 * an observation, not a signal to interpolate between.
 */
export function journeyLinesOption(opts: {
  dates: string[]
  totalLabel: string
  totalData: number[]
  totalColor: string
  series: Array<{ id: string; label: string; data: number[] }>
  colorIndex: (platformId: string) => number
  formatter: (value: number) => string
  masked?: boolean
  /** Horizontal goal line(s) — rendered as a markLine on the Total series. */
  goalLines?: Array<{ value: number; label: string }>
}): EChartsOption {
  const valueFmt = (v: number) => (opts.masked ? MASK_TEXT : opts.formatter(v))
  const palette = getChartPalette()
  const colorFor = (platformId: string) => palette[opts.colorIndex(platformId) % palette.length] ?? palette[0] ?? '#6f7cff'

  // No emphasis/blur override needed here (unlike the earlier stacked-area
  // version) — plain non-stacked lines never hit ECharts' "blur every series
  // to near-zero on axis hover" behavior, that was specific to stacked series
  // under an axis-triggered tooltip.
  const lineSeries = (name: string, data: number[], color: string, width: number, goalLines?: EChartsOption['series']) => ({
    name,
    type: 'line' as const,
    data,
    smooth: false,
    symbol: 'none',
    lineStyle: { width, color },
    itemStyle: { color },
    markLine: goalLines,
  })

  const goalMarkLine =
    opts.goalLines?.length
      ? ({
          silent: true,
          symbol: 'none',
          lineStyle: { color: resolveThemeColor('--warning', 'oklch(0.62 0.15 85)'), type: 'dashed' as const, width: 1.5 },
          label: { formatter: (p: { data?: { label?: string } }) => p.data?.label ?? '', color: resolveThemeColor('--warning', 'oklch(0.62 0.15 85)'), fontSize: 10, position: 'insideEndTop' as const },
          data: opts.goalLines.map((g) => ({ yAxis: g.value, label: { formatter: g.label } })),
        } as unknown as EChartsOption['series'])
      : undefined

  return {
    backgroundColor: 'transparent',
    textStyle: { color: chartText(), fontFamily: 'inherit' },
    tooltip: {
      trigger: 'axis',
      ...tooltipTheme(),
      formatter: (params: unknown) => {
        const rows = Array.isArray(params) ? params : [params]
        if (rows.length === 0) return ''
        const date = (rows[0] as { axisValueLabel?: string }).axisValueLabel ?? ''
        const totalRow = rows.find((r) => (r as { seriesName?: string }).seriesName === opts.totalLabel)
        const platformRows = rows.filter((r) => (r as { seriesName?: string }).seriesName !== opts.totalLabel)
        const rowHtml = (r: unknown) => {
          const row = r as { seriesName?: string; value?: unknown; color?: string }
          return `<div style="display:flex;justify-content:space-between;gap:12px;">
              <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${row.color};margin-right:6px;"></span>${row.seriesName}</span>
              <span style="font-variant-numeric:tabular-nums;">${valueFmt(Number(row.value) || 0)}</span>
            </div>`
        }
        const platformLines = platformRows.map(rowHtml).join('')
        const totalHtml = totalRow
          ? `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:4px;padding-top:4px;border-top:1px solid ${axisLine()};font-weight:600;">
              <span>${opts.totalLabel}</span><span style="font-variant-numeric:tabular-nums;">${valueFmt(Number((totalRow as { value?: unknown }).value) || 0)}</span>
            </div>`
          : ''
        return `<div style="font-weight:600;margin-bottom:4px;">${date}</div>${platformLines}${totalHtml}`
      },
    },
    grid: { left: 8, right: 8, top: 34, bottom: 4, containLabel: true },
    legend: {
      top: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 10,
      icon: 'circle',
      textStyle: { color: chartText(), fontSize: 11 },
      data: [opts.totalLabel, ...opts.series.map((s) => s.label)],
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: opts.dates.map((d) => d.slice(5)),
      axisLine: { lineStyle: { color: axisLine() } },
      axisLabel: { color: chartText(), fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: chartText(), fontSize: 11, formatter: (v: number) => valueFmt(v) },
      splitLine: { lineStyle: { color: axisLine(), type: 'dashed' } },
    },
    series: [
      lineSeries(opts.totalLabel, opts.totalData, opts.totalColor, 2.5, goalMarkLine),
      ...opts.series.map((s) => lineSeries(s.label, s.data, colorFor(s.id), 1.5)),
    ] as EChartsOption['series'],
  }
}

/**
 * Day-over-day change strip (Option A) — one labeled, sign-colored bar per
 * day. The literal "today vs past" comparison in numbers, paired below
 * trendAreaOption's line so the trend and the day-by-day moves that built it
 * are both readable without hovering. Caller should cap point count (bars
 * get unreadable past ~20-30 days) — this builder doesn't gate on it.
 */
export function dayChangeBarOption(opts: {
  dates: string[]
  changes: number[]
  formatter?: (value: number) => string
  masked?: boolean
}): EChartsOption {
  const fmt = opts.formatter ?? ((v: number) => String(v))
  const valueFmt = (v: number) => (opts.masked ? MASK_TEXT : fmt(v))
  // Sign-preserving cube-root compression: one outlier day (e.g. a big lump
  // sum) would otherwise dwarf the axis and flatten every other bar to ~0px,
  // making the strip convey nothing. This keeps every bar visually legible
  // regardless of magnitude while preserving relative order. The bar height
  // is compressed; the REAL ₹ value still drives the tooltip and the on-bar
  // label via opts.changes[dataIndex] below, never the compressed number.
  const compress = (v: number) => Math.sign(v) * Math.cbrt(Math.abs(v))
  return {
    backgroundColor: 'transparent',
    textStyle: { color: chartText(), fontFamily: 'inherit' },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      ...tooltipTheme(),
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params]
        return list
          .map((p) => {
            const idx = (p as { dataIndex: number }).dataIndex
            const v = opts.changes[idx] ?? 0
            return `${opts.dates[idx] ?? ''}: ${v >= 0 ? '+' : ''}${valueFmt(v)}`
          })
          .join('<br/>')
      },
    },
    grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: true,
      data: opts.dates.map((d) => d.slice(5)),
      axisLine: { lineStyle: { color: axisLine() } },
      axisLabel: { color: chartText(), fontSize: 10 },
      axisTick: { show: false },
    },
    yAxis: { type: 'value', show: false },
    series: [
      {
        name: 'Day change',
        type: 'bar',
        data: opts.changes.map((v) => ({
          value: compress(v),
          itemStyle: { color: v >= 0 ? GAIN : LOSS, borderRadius: 3 },
        })),
        barMaxWidth: 40,
        label: opts.masked
          ? { show: false }
          : {
              show: true,
              position: 'top' as const,
              fontSize: 10,
              fontWeight: 600 as const,
              color: chartText(),
              formatter: (p: { dataIndex: number }) => {
                const v = opts.changes[p.dataIndex] ?? 0
                return `${v >= 0 ? '+' : ''}${fmt(v)}`
              },
            },
      },
    ],
  }
}

/** Horizontal-ish bar list for per-holding returns (cost-bearing only). */
export function returnBarsOption(opts: {
  labels: string[]
  values: number[]
}): EChartsOption {
  return {
    backgroundColor: 'transparent',
    textStyle: { color: chartText(), fontFamily: 'inherit' },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      ...tooltipTheme(),
      valueFormatter: (v: unknown) => `${typeof v === 'number' ? v.toFixed(2) : v}%`,
    },
    grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: chartText(), fontSize: 11, formatter: '{value}%' },
      splitLine: { lineStyle: { color: axisLine() } },
    },
    yAxis: {
      type: 'category',
      data: opts.labels,
      axisLabel: { color: chartText(), fontSize: 10 },
      axisLine: { lineStyle: { color: axisLine() } },
      axisTick: { show: false },
    },
    series: [
      {
        name: 'Return',
        type: 'bar',
        data: opts.values.map((v) => ({
          value: v,
          itemStyle: { color: v >= 0 ? GAIN : LOSS, borderRadius: 2 },
        })),
        barMaxWidth: 12,
      },
    ],
  }
}

/**
 * M8.6 daily performance — dual-axis: day P&L bars (left) + portfolio value
 * area line (right). Bars are green on gain days, red on loss days; the value
 * curve gives the scale context. Mirrors trendAreaOption's palette/tooltip so
 * both charts read as one family.
 */
export function dailyPerformanceOption(opts: {
  dates: string[]
  dayPnl: number[]
  value: number[]
  formatter?: (value: number) => string
  /** When true, currency labels (tooltip + y-axes) render as MASK_TEXT. */
  masked?: boolean
}): EChartsOption {
  const fmt = opts.formatter ?? ((v: number) => String(v))
  const valueFmt = (v: number) => (opts.masked ? MASK_TEXT : fmt(v))
  return {
    backgroundColor: 'transparent',
    textStyle: { color: chartText(), fontFamily: 'inherit' },
    tooltip: {
      trigger: 'axis',
      ...tooltipTheme(),
      valueFormatter: (v: unknown) => valueFmt(typeof v === 'number' ? v : 0),
    },
    grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: true, // bars sit between ticks
      data: opts.dates.map((d) => d.slice(5)), // MM-DD tick labels
      axisLine: { lineStyle: { color: axisLine() } },
      axisLabel: { color: chartText(), fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: 'Day P&L',
        nameTextStyle: { color: chartText(), fontSize: 10 },
        axisLabel: { color: chartText(), fontSize: 11, formatter: (v: number) => valueFmt(v) },
        splitLine: { lineStyle: { color: axisLine() } },
      },
      {
        type: 'value',
        name: 'Value',
        nameTextStyle: { color: chartText(), fontSize: 10 },
        axisLabel: { color: chartText(), fontSize: 11, formatter: (v: number) => valueFmt(v) },
        splitLine: { show: false },
      },
    ],
    legend: {
      top: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 10,
      icon: 'circle',
      textStyle: { color: chartText(), fontSize: 11 },
    },
    series: [
      {
        name: 'Day P&L',
        type: 'bar',
        data: opts.dayPnl.map((v) => ({
          value: v,
          itemStyle: { color: v >= 0 ? GAIN : LOSS, borderRadius: 2 },
        })),
        barMaxWidth: 14,
      },
      {
        name: 'Portfolio value',
        type: 'line',
        yAxisIndex: 1,
        data: opts.value,
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: false,
        lineStyle: { width: 2, color: CATEGORY_COLORS[0] },
        itemStyle: { color: CATEGORY_COLORS[0] },
        areaStyle: { opacity: 0.15 },
      },
    ],
  }
}

/**
 * M8.6 simple-return line over the performance dates. Values are PERCENTAGES,
 * so they stay visible under the privacy mask by design (privacy.tsx: "percentages
 * reveal no net worth"). Null entries render as gaps in the line (honest about
 * days where the return is not computable).
 */
export function simpleReturnLineOption(opts: {
  dates: string[]
  values: Array<number | null>
}): EChartsOption {
  return {
    backgroundColor: 'transparent',
    textStyle: { color: chartText(), fontFamily: 'inherit' },
    color: [CATEGORY_COLORS[2] ?? '#e2b93d'],
    tooltip: {
      trigger: 'axis',
      ...tooltipTheme(),
      valueFormatter: (v: unknown) => (typeof v === 'number' ? `${v.toFixed(2)}%` : '—'),
    },
    grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: opts.dates.map((d) => d.slice(5)),
      axisLine: { lineStyle: { color: axisLine() } },
      axisLabel: { color: chartText(), fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: chartText(), fontSize: 11, formatter: '{value}%' },
      splitLine: { lineStyle: { color: axisLine() } },
    },
    series: [
      {
        name: 'Simple return',
        type: 'line',
        data: opts.values,
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: false,
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.15 },
      },
    ],
  }
}

/**
 * M8.6 attribution — horizontal bars for one dimension (byGeography /
 * byPlatform / byAssetClass) of a single day's day P&L. Bars color by sign;
 * the tooltip + axis honor the privacy mask (these are ₹ amounts).
 */
export function attributionBarsOption(opts: {
  labels: string[]
  values: number[]
  formatter?: (value: number) => string
  masked?: boolean
}): EChartsOption {
  const fmt = opts.formatter ?? ((v: number) => String(v))
  const valueFmt = (v: number) => (opts.masked ? MASK_TEXT : fmt(v))
  return {
    backgroundColor: 'transparent',
    textStyle: { color: chartText(), fontFamily: 'inherit' },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      ...tooltipTheme(),
      valueFormatter: (v: unknown) => valueFmt(typeof v === 'number' ? v : 0),
    },
    grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: chartText(), fontSize: 11, formatter: (v: number) => valueFmt(v) },
      splitLine: { lineStyle: { color: axisLine() } },
    },
    yAxis: {
      type: 'category',
      data: opts.labels,
      axisLabel: { color: chartText(), fontSize: 10 },
      axisLine: { lineStyle: { color: axisLine() } },
      axisTick: { show: false },
    },
    series: [
      {
        name: 'Contribution',
        type: 'bar',
        data: opts.values.map((v) => ({
          value: v,
          itemStyle: { color: v >= 0 ? GAIN : LOSS, borderRadius: 2 },
        })),
        barMaxWidth: 14,
      },
    ],
  }
}

/**
 * Categorical horizontal bars — one bar per category (e.g. platform), colored
 * by a caller-supplied palette (not by sign, unlike attributionBarsOption
 * above — every value here is a positive ₹ holding, not a gain/loss). Used by
 * Allocation's "Platform breakdown" card (design brief §3.2) to give the
 * per-platform % donuts a companion absolute-₹ view.
 */
export function categoryValueBarsOption(opts: {
  labels: string[]
  values: number[]
  colors: string[]
  formatter?: (value: number) => string
  masked?: boolean
}): EChartsOption {
  const fmt = opts.formatter ?? ((v: number) => String(v))
  const valueFmt = (v: number) => (opts.masked ? MASK_TEXT : fmt(v))
  return {
    backgroundColor: 'transparent',
    textStyle: { color: chartText(), fontFamily: 'inherit' },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      ...tooltipTheme(),
      valueFormatter: (v: unknown) => valueFmt(typeof v === 'number' ? v : 0),
    },
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: chartText(), fontSize: 11, formatter: (v: number) => valueFmt(v) },
      splitLine: { lineStyle: { color: axisLine() } },
    },
    yAxis: {
      type: 'category',
      data: opts.labels,
      axisLabel: { color: chartText(), fontSize: 11 },
      axisLine: { lineStyle: { color: axisLine() } },
      axisTick: { show: false },
    },
    series: [
      {
        name: 'Value',
        type: 'bar',
        data: opts.values.map((v, i) => ({
          value: v,
          itemStyle: { color: opts.colors[i % opts.colors.length], borderRadius: 3 },
        })),
        barMaxWidth: 22,
        label: opts.masked
          ? { show: false }
          : {
              show: true,
              position: 'right' as const,
              fontSize: 11,
              fontWeight: 600 as const,
              color: chartText(),
              formatter: (p) => fmt(Number(p.value)),
            },
      },
    ],
  }
}

/**
 * Allocation donut — a true ring (`radius: ['55%', '80%']`, not a filled
 * pie), one slice per category. Direct on-chart labels stay off by design:
 * the caller pairs this with a real legend list (exact numbers, never
 * color-alone) beside/below it, same as every other chart in this app —
 * the donut's job is just the at-a-glance shape of the whole.
 *
 * `colors` must already be RESOLVED concrete values (hex/oklch), not raw
 * `var(--chart-N)` strings — this renders to a <canvas>, which can't resolve
 * CSS custom properties the way DOM elements can (see getChartPalette()).
 * `borderColor` should be the resolved `--card` value so the gap between
 * slices reads as a gap, not a colored ring seam.
 */
export function donutOption(opts: {
  labels: string[]
  values: number[]
  colors: string[]
  borderColor?: string
  masked?: boolean
}): EChartsOption {
  return {
    backgroundColor: 'transparent',
    textStyle: { color: chartText(), fontFamily: 'inherit' },
    tooltip: {
      trigger: 'item',
      ...tooltipTheme(),
      formatter: (p: unknown) => {
        const { name, percent } = p as { name: string; percent: number }
        return opts.masked ? `${name}: ${MASK_TEXT}` : `${name}: ${percent}%`
      },
    },
    series: [
      {
        name: 'Allocation',
        type: 'pie',
        radius: ['55%', '80%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderColor: opts.borderColor ?? 'transparent',
          borderWidth: 2,
        },
        label: { show: false },
        labelLine: { show: false },
        emphasis: {
          scaleSize: 4,
        },
        data: opts.labels.map((name, i) => ({
          name,
          value: opts.values[i],
          itemStyle: { color: opts.colors[i % opts.colors.length] },
        })),
      },
    ],
  }
}

/**
 * Resolve the theme-aware chart palette from the CSS custom properties
 * (--chart-1..9) set on :root / .dark in index.css. Falls back to the
 * hardcoded CATEGORY_COLORS if the vars aren't present (e.g. SSR).
 */
export function getChartPalette(): string[] {
  if (typeof document !== 'undefined') {
    const styles = getComputedStyle(document.documentElement)
    const colors: string[] = []
    for (let i = 1; i <= 9; i++) {
      const v = styles.getPropertyValue(`--chart-${i}`).trim()
      if (v) colors.push(v)
    }
    if (colors.length) return colors
  }
  return CATEGORY_COLORS
}

/** Resolve a single CSS custom property (e.g. `--card`) to its current
 *  computed value, for the same canvas-can't-read-var() reason as
 *  getChartPalette() above. Falls back to `fallback` when unavailable. */
export function resolveThemeColor(varName: string, fallback: string): string {
  if (typeof document !== 'undefined') {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
    if (v) return v
  }
  return fallback
}

/** ECharts linear-gradient object for area fills (top → bottom fade). */
export function gradientFill(
  color: string,
): { type: 'linear'; x: number; y: number; x2: number; y2: number; colorStops: { offset: number; color: string }[] } {
  return {
    type: 'linear',
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color },
      { offset: 1, color: 'transparent' },
    ],
  }
}

/** dataZoom option for zoomable charts — inside (wheel/pinch) + optional slider. */
export function dataZoomOption(
  opts: { start?: number; end?: number; showSlider?: boolean } = {},
) {
  const { start = 0, end = 100, showSlider = false } = opts
  const zooms: unknown[] = [
    {
      type: 'inside',
      start,
      end,
    },
  ]
  if (showSlider) {
    zooms.push({ type: 'slider', bottom: 0, start, end })
  }
  return zooms
}