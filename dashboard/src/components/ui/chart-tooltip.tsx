"use client"

import * as React from "react"
import { Tooltip as RechartsTooltip, TooltipProps } from "recharts"
import { cn } from "@/lib/utils"
import { useChartConfig } from "./chart"

interface ChartTooltipProps extends Omit<TooltipProps, "content" | "formatter"> {
  content?: React.ReactNode
  formatter?: (value: any, name: string, itemProps: any) => React.ReactNode
}

export function ChartTooltip({ content, formatter, ...props }: ChartTooltipProps) {
  const { config } = useChartConfig()

  const defaultFormatter = React.useCallback(
    (value: any, name: string, itemProps: any) => {
      const cfg = config[name]
      if (!cfg) return value
      if (formatter) return formatter(value, name, itemProps)
      return `${cfg.label || name}: ${value}`
    },
    [config, formatter]
  )

  return (
    <RechartsTooltip
      {...props}
      content={content as any}
      formatter={defaultFormatter as any}
      contentStyle={{
        backgroundColor: "hsl(var(--muted))",
        border: "1px solid hsl(var(--border))",
        borderRadius: "var(--radius)",
        padding: "8px 12px",
        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
      }}
      labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
      itemStyle={{ color: "hsl(var(--foreground))" }}
    />
  )
}

interface ChartTooltipContentProps {
  active?: boolean
  payload?: Array<{ value: number | string; name: string; color: string; payload: any }>
  label?: string | number
  formatter?: (value: number | string | undefined, name: string, props: any) => React.ReactNode
  className?: string
  hideLabel?: boolean
  hideIndicator?: boolean
  nameKey?: string
  labelKey?: string
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  formatter,
  className,
  hideLabel,
  hideIndicator,
  nameKey = "name",
  labelKey = "value",
}: ChartTooltipContentProps) {
  const { config } = useChartConfig()

  if (!active || !payload || !payload.length) return null

  const filteredPayload = payload.filter((item) => item.value !== null && item.value !== undefined)
  if (!filteredPayload.length) return null

  const labelPayload = filteredPayload.find((item) => item.payload[nameKey] === label)
  const displayLabel = labelPayload ? labelPayload.payload[labelKey] : label

  return (
    <div
      className={cn(
        "grid gap-1 p-3 text-xs",
        "bg-muted border border-border rounded-lg shadow-lg",
        className
      )}
    >
      {!hideLabel && displayLabel !== undefined && (
        <div className="font-semibold text-foreground">
          {displayLabel}
        </div>
      )}
      <div className="grid gap-1.5">
        {filteredPayload.map((item, index) => {
          const cfg = config[item.payload[nameKey]]
          const color = cfg?.color || item.color
          const itemLabel = cfg?.label || item.payload[nameKey]
          const value = typeof item.payload[labelKey] === "number" ? item.payload[labelKey] : item.value

          return (
            <div
              key={`${item.payload[nameKey]}-${index}`}
              className="flex items-center gap-2"
              style={{ color: color }}
            >
              {!hideIndicator && (
                <div
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
              )}
              <span className="text-muted-foreground">{itemLabel}</span>
              <span className="font-medium text-foreground ml-auto">
                {formatter ? formatter(value, itemLabel, item.payload) : value}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface ChartCursorProps {
  stroke?: string
  strokeDasharray?: string
  className?: string
}

export function ChartCursor({ stroke = "hsl(var(--muted-foreground))", strokeDasharray = "4 4", className }: ChartCursorProps) {
  return <line stroke={stroke} strokeDasharray={strokeDasharray} className={className} />
}