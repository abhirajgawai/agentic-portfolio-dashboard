/**
 * src/lib/sparkline.ts — Mini ECharts option builder for in-row 7-day trend
 * sparklines. Data source: history.byPlatform[platform] (the honest fallback —
 * per-holding history is NOT in the contract). Tooltip shows the platform value
 * series; no axes, no legend.
 *
 * The builder is a PURE function (no state, no effects) so it is safe to call
 * per-platform in a loop (e.g. HoldingsTable's sparkline column). `useSparklineOption`
 * is an alias kept for callers that prefer a hook name — it holds no state.
 */

import type { EChartsOption } from 'echarts'

export function buildSparklineOption(
  platform: string,
  historyByPlatform: Record<string, number[]>,
): EChartsOption | null {
  const data = historyByPlatform[platform] ?? []
  // Trim leading/trailing non-running (zero) days so a sparkline never looks
  // like the platform crashed to zero before it started running (see
  // AccountRoads.roadSeries for the same honesty rule).
  const start = data.findIndex((v) => v > 0)
  if (start === -1 || data.length === 0) return null
  let end = data.length - 1
  while (end > start && (data[end] ?? 0) === 0) end -= 1
  const series = data.slice(start, end + 1)
  const last = series[series.length - 1] ?? 0
  const first = series[0] ?? 0

  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 0, right: 0, top: 2, bottom: 2 },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: series.map((_, i) => i) },
    yAxis: { type: 'value', show: false, min: 'dataMin', max: 'dataMax' },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20,20,24,0.92)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e8e8ea', fontSize: 10 },
      formatter: (params: unknown) => {
        const rows = params as Array<{ value?: number }>
        const value = typeof rows?.[0]?.value === 'number' ? rows[0].value : 0
        return `<b>${Math.round(value).toLocaleString('en-IN')}</b>`
      },
    },
    series: [
      {
        type: 'line',
        data: series,
        smooth: 0.3,
        symbol: 'none',
        lineStyle: { width: 1.5, color: last >= first ? '#63d6a5' : '#d0655e' },
        itemStyle: { color: last >= first ? '#63d6a5' : '#d0655e' },
        areaStyle: { opacity: 0.1 },
      },
    ],
  }
}

/** Hook-style alias of the pure builder (no state) — for callers that prefer a
 *  `use*` name. Calling it inside a loop or callback is safe because it holds no
 *  React state. */
export function useSparklineOption(
  platform: string,
  historyByPlatform: Record<string, number[]>,
): EChartsOption | null {
  return buildSparklineOption(platform, historyByPlatform)
}

/** The trend's own % move (first non-zero day -> latest), for a direct label
 *  next to the sparkline — a bare unlabeled line answers nothing on its own.
 *  Same trim rule as buildSparklineOption (never divide against a leading
 *  zero the platform hadn't started reporting yet). null when there's
 *  nothing to compare (platform has no history, or only one point). */
export function platformTrendPct(
  platform: string,
  historyByPlatform: Record<string, number[]>,
): number | null {
  const data = historyByPlatform[platform] ?? []
  const start = data.findIndex((v) => v > 0)
  if (start === -1) return null
  let end = data.length - 1
  while (end > start && (data[end] ?? 0) === 0) end -= 1
  const first = data[start] ?? 0
  const last = data[end] ?? 0
  if (end <= start || first === 0) return null
  return ((last - first) / first) * 100
}