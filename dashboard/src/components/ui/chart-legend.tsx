"use client"

import * as React from "react"
import { Legend as RechartsLegend, LegendProps } from "recharts"
import { cn } from "@/lib/utils"
import { useChartConfig } from "./chart"

interface ChartLegendProps extends Omit<LegendProps, "formatter"> {
  formatter?: (value: string, entry: any, index: number) => React.ReactNode
}

export function ChartLegend({ formatter, className, ...props }: ChartLegendProps) {
  const { config } = useChartConfig()

  const defaultFormatter = React.useCallback(
    (value: string) => {
      const cfg = config[value]
      return cfg?.label || value
    },
    [config]
  )

  return (
    <RechartsLegend
      {...props}
      formatter={formatter || defaultFormatter}
      wrapperStyle={{
        padding: 0,
        margin: 0,
      }}
      className={cn("flex flex-wrap items-center gap-4", className)}
      iconSize={12}
      layout="horizontal"
    />
  )
}

interface ChartLegendContentProps {
  name: string
  color: string
  className?: string
  hideIndicator?: boolean
  formatter?: (value: string) => React.ReactNode
}

export function ChartLegendContent({
  name,
  color,
  className,
  hideIndicator,
  formatter,
}: ChartLegendContentProps) {
  const { config } = useChartConfig()
  const cfg = config[name]
  const label = formatter ? formatter(name) : cfg?.label || name
  const indicatorColor = cfg?.color || color

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs font-medium",
        className
      )}
    >
      {!hideIndicator && (
        <div
          className="h-2.5 w-2.5 rounded-[2px]"
          style={{ backgroundColor: indicatorColor }}
        />
      )}
      <span className="text-foreground">{label}</span>
    </div>
  )
}