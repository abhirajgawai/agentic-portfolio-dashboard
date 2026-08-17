/**
 * Modular ECharts registration — tree-shaken bundle.
 *
 * The DASHBOARD_PLAN approved ECharts with `echarts/core` modular imports
 * (vs. the full `echarts` import, which pulls every chart type + renderer).
 * We register ONLY the charts and components the dashboard uses:
 *   charts:      pie (donuts), line/bar (trend, returns)
 *   components:  grid, tooltip, legend, title, dataZoom (future price panes)
 *   renderer:    canvas (SVG adds nothing here)
 *
 * Every EChart component imports the shared `echarts` instance from here —
 * registering the same modules twice is a no-op, so chart components stay
 * independently importable.
 */

import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  PieChart,
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  CanvasRenderer,
])

export { echarts }