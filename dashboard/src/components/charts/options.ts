/**
 * Shared ECharts option builders — one dark, theme-consistent look for every
 * chart (trend area, return bars, performance). Kept here so screens stay thin
 * and the palette lives in ONE place (the M9 swap touches nothing chart-related).
 * The allocation donuts moved to shadcn/Recharts (AllocationDonuts) in M8.7.
 */

import type { EChartsOption } from 'echarts'

import { MASK_TEXT } from '@/lib/format'

/** Muted foreground — matches --muted-foreground so charts blend with the UI. */
export const CHART_TEXT = '#9b9ba3'
export const AXIS_LINE = 'rgba(255,255,255,0.08)'

/** Categorical palette (mirrors the --chart-* tokens in index.css). */
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

const baseTextStyle = { color: CHART_TEXT, fontFamily: 'inherit' }

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
}): EChartsOption {
  const fmt = opts.formatter ?? ((v: number) => String(v))
  const valueFmt = (v: number) => (opts.masked ? MASK_TEXT : fmt(v))
  return {
    backgroundColor: 'transparent',
    textStyle: baseTextStyle,
    color: CATEGORY_COLORS,
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20,20,24,0.92)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e8e8ea' },
      valueFormatter: (v: unknown) => valueFmt(typeof v === 'number' ? v : 0),
    },
    grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: opts.dates.map((d) => d.slice(5)), // MM-DD tick labels
      axisLine: { lineStyle: { color: AXIS_LINE } },
      axisLabel: { color: CHART_TEXT, fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: CHART_TEXT,
        fontSize: 11,
        formatter: (v: number) => valueFmt(v),
      },
      splitLine: { lineStyle: { color: AXIS_LINE } },
    },
    legend: {
      top: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 10,
      icon: 'circle',
      textStyle: { color: CHART_TEXT, fontSize: 11 },
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
              color: CHART_TEXT,
              formatter: (p: { value: number }) => fmt(p.value),
            }
          : { show: false },
    })),
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
  return {
    backgroundColor: 'transparent',
    textStyle: baseTextStyle,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(20,20,24,0.92)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e8e8ea' },
      valueFormatter: (v: unknown) => valueFmt(typeof v === 'number' ? v : 0),
    },
    grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: true,
      data: opts.dates.map((d) => d.slice(5)),
      axisLine: { lineStyle: { color: AXIS_LINE } },
      axisLabel: { color: CHART_TEXT, fontSize: 10 },
      axisTick: { show: false },
    },
    yAxis: { type: 'value', show: false },
    series: [
      {
        name: 'Day change',
        type: 'bar',
        data: opts.changes.map((v) => ({
          value: v,
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
              color: CHART_TEXT,
              formatter: (p: { value: number }) => `${p.value >= 0 ? '+' : ''}${fmt(p.value)}`,
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
    textStyle: baseTextStyle,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(20,20,24,0.92)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e8e8ea' },
      valueFormatter: (v: unknown) => `${typeof v === 'number' ? v.toFixed(2) : v}%`,
    },
    grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: CHART_TEXT, fontSize: 11, formatter: '{value}%' },
      splitLine: { lineStyle: { color: AXIS_LINE } },
    },
    yAxis: {
      type: 'category',
      data: opts.labels,
      axisLabel: { color: CHART_TEXT, fontSize: 10 },
      axisLine: { lineStyle: { color: AXIS_LINE } },
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
    textStyle: baseTextStyle,
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20,20,24,0.92)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e8e8ea' },
      valueFormatter: (v: unknown) => valueFmt(typeof v === 'number' ? v : 0),
    },
    grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: true, // bars sit between ticks
      data: opts.dates.map((d) => d.slice(5)), // MM-DD tick labels
      axisLine: { lineStyle: { color: AXIS_LINE } },
      axisLabel: { color: CHART_TEXT, fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: 'Day P&L',
        nameTextStyle: { color: CHART_TEXT, fontSize: 10 },
        axisLabel: { color: CHART_TEXT, fontSize: 11, formatter: (v: number) => valueFmt(v) },
        splitLine: { lineStyle: { color: AXIS_LINE } },
      },
      {
        type: 'value',
        name: 'Value',
        nameTextStyle: { color: CHART_TEXT, fontSize: 10 },
        axisLabel: { color: CHART_TEXT, fontSize: 11, formatter: (v: number) => valueFmt(v) },
        splitLine: { show: false },
      },
    ],
    legend: {
      top: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 10,
      icon: 'circle',
      textStyle: { color: CHART_TEXT, fontSize: 11 },
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
    textStyle: baseTextStyle,
    color: [CATEGORY_COLORS[2] ?? '#e2b93d'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20,20,24,0.92)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e8e8ea' },
      valueFormatter: (v: unknown) => (typeof v === 'number' ? `${v.toFixed(2)}%` : '—'),
    },
    grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: opts.dates.map((d) => d.slice(5)),
      axisLine: { lineStyle: { color: AXIS_LINE } },
      axisLabel: { color: CHART_TEXT, fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: CHART_TEXT, fontSize: 11, formatter: '{value}%' },
      splitLine: { lineStyle: { color: AXIS_LINE } },
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
    textStyle: baseTextStyle,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(20,20,24,0.92)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e8e8ea' },
      valueFormatter: (v: unknown) => valueFmt(typeof v === 'number' ? v : 0),
    },
    grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: CHART_TEXT, fontSize: 11, formatter: (v: number) => valueFmt(v) },
      splitLine: { lineStyle: { color: AXIS_LINE } },
    },
    yAxis: {
      type: 'category',
      data: opts.labels,
      axisLabel: { color: CHART_TEXT, fontSize: 10 },
      axisLine: { lineStyle: { color: AXIS_LINE } },
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
    textStyle: baseTextStyle,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(20,20,24,0.92)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e8e8ea' },
      valueFormatter: (v: unknown) => valueFmt(typeof v === 'number' ? v : 0),
    },
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: CHART_TEXT, fontSize: 11, formatter: (v: number) => valueFmt(v) },
      splitLine: { lineStyle: { color: AXIS_LINE } },
    },
    yAxis: {
      type: 'category',
      data: opts.labels,
      axisLabel: { color: CHART_TEXT, fontSize: 11 },
      axisLine: { lineStyle: { color: AXIS_LINE } },
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
              color: CHART_TEXT,
              formatter: (p) => fmt(Number(p.value)),
            },
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