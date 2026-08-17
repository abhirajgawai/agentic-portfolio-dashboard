/**
 * Thin typed wrapper around echarts-for-react's core entry.
 *
 * echarts-for-react's `lib/core` accepts an `echarts` instance prop — we pass
 * the modular-registered instance from lib/charts.ts so only the chart types
 * we actually use end up in the bundle.
 */

import type { EChartsOption } from 'echarts'
import ReactEChartsCore from 'echarts-for-react/lib/core'

import { echarts } from '@/lib/charts'
import { cn } from '@/lib/utils'

type EChartProps = {
  option: EChartsOption
  height?: number | string
  className?: string
}

export function EChart({ option, height = 240, className }: EChartProps) {
  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      notMerge
      lazyUpdate
      className={cn('w-full', className)}
      style={{ height, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}