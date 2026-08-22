"use client"

import * as React from "react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  RadialBarChart,
  RadialBar,
  ScatterChart,
  Scatter,
  ReferenceLine,
  ReferenceDot,
  ReferenceArea,
  Brush,
} from "recharts"
import { cn } from "@/lib/utils"

export interface ChartConfig {
  [k: string]: {
    label?: string
    icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
    color?: string
  }
}

interface ChartContextProps {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

export function useChartConfig() {
  const context = React.useContext(ChartContext)
  if (!context) {
    throw new Error("useChartConfig must be used within a ChartContainer")
  }
  return context
}

interface ChartContainerProps {
  children: React.ReactNode
  config: ChartConfig
  className?: string
}

export function ChartContainer({
  children,
  config,
  className,
}: ChartContainerProps) {
  const uniqueId = React.useId()
  const cssVariables = React.useMemo(() => {
    const variables: Record<string, string> = {}
    for (const [key, value] of Object.entries(config)) {
      if (value.color) {
        variables[`--color-${key}`] = value.color
      }
    }
    return variables
  }, [config])

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        className={cn("w-full h-full", className)}
        style={cssVariables as React.CSSProperties}
        data-chart-id={uniqueId}
      >
        {children}
      </div>
    </ChartContext.Provider>
  )
}

interface ChartStyleProps {
  id?: string
  className?: string
  children?: React.ReactNode
}

export function ChartStyle({ id, className, children }: ChartStyleProps) {
  const { config } = useChartConfig()
  const generatedId = React.useId()
  const chartId = id || `chart-${generatedId}`

  return (
    <defs>
      <style
        className={cn("text-[10px]", className)}
        dangerouslySetInnerHTML={{
          __html: Object.entries(config)
            .map(([key, value]) => {
              if (value.color) {
                return `[data-chart-id="${chartId}"] [stroke="${value.color}"] { stroke: var(--color-${key}) }`
              }
              return ""
            })
            .join(""),
        }}
      />
      {children}
    </defs>
  )
}

type ChartPrimitiveProps = React.ComponentPropsWithoutRef<typeof AreaChart> & {
  config?: ChartConfig
}

export const ChartPrimitive = React.forwardRef<
  HTMLDivElement,
  ChartPrimitiveProps
>(({ className, config, style, ...props }, ref) => {
  const contextConfig = useChartConfig()
  const mergedConfig = config || contextConfig.config

  return (
    <ResponsiveContainer
      ref={ref}
      className={cn("w-full h-full", className)}
      style={style}
    >
      <AreaChart {...props}>
        <ChartStyle />
        {React.Children.map(props.children, (child) => {
          if (!React.isValidElement(child)) return child
          return React.cloneElement(child as React.ReactElement<any>, {
            ...(child.props as Record<string, unknown>),
            config: mergedConfig,
          } as any)
        })}
      </AreaChart>
    </ResponsiveContainer>
  )
})
ChartPrimitive.displayName = "ChartPrimitive"

export {
  AreaChart,
  Area,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  RadialBarChart,
  RadialBar,
  ScatterChart,
  Scatter,
  ReferenceLine,
  ReferenceDot,
  ReferenceArea,
  Brush,
}