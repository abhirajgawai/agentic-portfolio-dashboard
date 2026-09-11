/**
 * src/components/shell/MiniDonut.tsx — Compact 64px EChart donut for the
 * ContextRail allocation section. Renders a centered donut ring with no
 * labels/legend; tooltip shows slice details on hover. Uses the shared
 * registered ECharts instance from lib/charts (tree-shaken).
 *
 * Supports an optional `onSliceClick` callback — when provided, clicking a
 * donut slice fires `onSliceClick(sliceName)`. Used by ContextRail to wire
 * cross-filter from donut → FilterContext.
 */

import { useEffect, useMemo, useRef } from 'react'
import type { EChartsOption } from 'echarts'

import { echarts } from '@/lib/charts'
import { getChartPalette } from '@/components/charts/options'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

interface MiniDonutProps {
  /** Allocation data, e.g. { "IN": 62, "US": 38 }. Values are percentages. */
  data: Record<string, number>
  /** Optional custom colors (falls back to chart palette). */
  colors?: string[]
  /** Container size in px (default 64). */
  size?: number
  /** Called when a donut slice is clicked with the slice name. */
  onSliceClick?: (name: string) => void
}

export function MiniDonut({ data, colors, size = 64, onSliceClick }: MiniDonutProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)
  const { resolvedTheme } = useTheme()

  // Create the chart instance once the container mounts; tear it down on unmount.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const chart = echarts.init(el, undefined, { renderer: 'canvas' })
    chartRef.current = chart

    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  // Wire the slice click callback to the ECharts click event.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !onSliceClick) return

    const handler = (params: unknown) => {
      if (
        typeof params === 'object' &&
        params !== null &&
        'name' in params &&
        typeof (params as Record<string, unknown>).name === 'string'
      ) {
        const name = (params as Record<string, string>).name
        if (name !== undefined) onSliceClick(name)
      }
    }
    chart.on('click', handler)
    return () => {
      chart.off('click', handler)
    }
  }, [onSliceClick])

  // Build the chart option from the allocation data.
  const option: EChartsOption = useMemo(() => {
    const palette = colors ?? getChartPalette()
    const seriesData = Object.entries(data)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])

    return {
      backgroundColor: 'transparent',
      color: palette,
      tooltip: {
        show: true,
        trigger: 'item',
        backgroundColor: 'rgba(20,20,24,0.92)',
        borderColor: 'rgba(255,255,255,0.1)',
        textStyle: { color: '#e8e8ea', fontSize: 11 },
        formatter: '{b}: {d}%',
      },
      series: [
        {
          name: 'Allocation',
          type: 'pie',
          radius: ['50%', '75%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderColor: 'rgba(10,10,12,0.9)',
            borderWidth: 1,
          },
          label: { show: false },
          emphasis: {
            label: { show: false },
            scaleSize: 2,
          },
          data: seriesData.map(([name, value]) => ({
            name,
            value: Math.round(value * 10) / 10,
          })),
        },
      ],
    }
    // resolvedTheme isn't read directly, but getChartPalette() reads live
    // CSS custom properties off <html> — this dep re-runs the memo (and
    // repaints the canvas) on a theme toggle instead of leaving stale colors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, colors, resolvedTheme])

  // Push new options whenever they change.
  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true, lazyUpdate: true })
  }, [option])

  return (
    <div
      ref={containerRef}
      style={{ width: size, height: size }}
      className={cn('mx-auto shrink-0', onSliceClick && 'cursor-pointer')}
    />
  )
}
