/**
 * Thin typed wrapper around a directly-managed ECharts instance.
 *
 * We use `echarts/core` directly (the modular instance registered in
 * lib/charts.ts) instead of `echarts-for-react`. The latter is a CJS class
 * component whose default export breaks under Vite + React 19 interop
 * ("Element type is invalid: expected ... but got: object"), which white-
 * screens the whole app. Managing the instance ourselves is a few lines,
 * needs no extra dependency, and keeps the tree-shaken bundle.
 */

import type { EChartsOption } from 'echarts'
import { memo, useEffect, useRef } from 'react'

import { echarts } from '@/lib/charts'
import { cn } from '@/lib/utils'

type EChartProps = {
  option: EChartsOption
  height?: number | string
  className?: string
  /** Event name → handler (e.g. `{ click: (p) => ... }`). Re-bound on change.
   *  The payload is the ECharts event object (shape varies by event/series);
   *  consumers cast it to the shape they need (pie click → { name, dataIndex }). */
  onEvents?: Record<string, (params: unknown) => void>
}

/**
 * Sparkline threshold: below this height (in px) we skip ResizeObserver because
 * the table cell fixes the size. Avoids 69 ResizeObservers for in-row sparklines.
 */
const SPARKLINE_HEIGHT_THRESHOLD = 32

export const EChart = memo(function EChart({ option, height = 240, className, onEvents: _onEvents }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)
  const isSparkline = typeof height === 'number' && height <= SPARKLINE_HEIGHT_THRESHOLD

  // Create the chart instance once the container mounts; tear it down on unmount.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const chart = echarts.init(el, undefined, { renderer: 'canvas' })
    chartRef.current = chart

    // For full-size charts, keep responsive via ResizeObserver.
    // For sparklines (fixed cell height), skip — avoids forced reflows.
    let ro: ResizeObserver | null = null
    if (!isSparkline) {
      ro = new ResizeObserver(() => chart.resize())
      ro.observe(el)
    }

    return () => {
      ro?.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [isSparkline])

  // Push new options whenever they change. notMerge so removed series don't linger.
  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true, lazyUpdate: true })
  }, [option])

  return (
    <div
      ref={containerRef}
      className={cn('w-full', className)}
      style={{ height, width: '100%' }}
    />
  )
})
