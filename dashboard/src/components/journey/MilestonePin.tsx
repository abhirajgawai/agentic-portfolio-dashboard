"use client"

/**
 * MilestonePin — custom pin marker for JourneyChart milestones.
 *
 * Recharts only provides `ReferenceDot` (a circle). This component uses
 * `useXAxisScale` / `useYAxisScale` to position an SVG pin shape at
 * the correct data coordinates. The pin matches the ECharts markPoint
 * pin: diamond head with a tapered tail.
 *
 * This component MUST be rendered as a child of ComposedChart/AreaChart/etc.
 * to access the Recharts scale context via hooks.
 */

import * as React from "react"
import { useXAxisScale, useYAxisScale } from "recharts"
import { useId } from "react"
import { ChartTooltipContent } from "@/components/ui/chart-tooltip"
import { formatInrCompact, MASK_TEXT } from "@/lib/format"
import { usePrivacy } from "@/lib/privacy"

interface MilestonePinProps {
  /** X coordinate in data space (date string) */
  x: string
  /** Y coordinate in data space (portfolio value in base currency) */
  y: number
  /** Human-readable description for tooltip */
  description: string
  /** Optional: payload for additional context */
  payload?: Record<string, unknown>
  /** Whether this pin is currently active/hovered */
  isActive?: boolean
}

export function MilestonePin({
  x,
  y,
  description,
  payload,
  isActive = false,
}: MilestonePinProps) {
  const xScale = useXAxisScale()
  const yScale = useYAxisScale()
  const { masked } = usePrivacy()
  const gradientId = useId()

  // Compute SVG coordinates from data coordinates
  const cx = xScale?.(x)
  const cy = yScale?.(y)

  // If scales aren't ready or coords are out of bounds, don't render
  if (cx === undefined || cy === undefined || Number.isNaN(cx) || Number.isNaN(cy)) {
    return null
  }

  // Pin SVG path: diamond head (6px radius) + tapered tail
  // M0,0 L-6,12 L0,14 L6,12 Z — centered at (0,0), tip at y=14
  const pinPath = "M0,0 L-6,12 L0,14 L6,12 Z"

  const pinValue = (payload?.value as number) ?? y

  return (
    <g transform={`translate(${cx}, ${cy})`} style={{ zIndex: 10 }}>
      {/* Unique gradient per instance for the pin fill */}
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={1} />
          <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.8} />
        </linearGradient>
      </defs>

      {/* Pin shape */}
      <path
        d={pinPath}
        fill={`url(#${gradientId})`}
        stroke="var(--background)"
        strokeWidth={2}
        style={{
          filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.15))",
          cursor: "default",
          transition: "transform 150ms var(--ease-out)",
          transform: isActive ? "scale(1.15)" : "scale(1)",
          transformOrigin: "center bottom",
        }}
      />

      {/* Tooltip rendered inline when active — positioned above the pin */}
      {isActive && (
        <g transform="translate(0, -22)">
          <ChartTooltipContent
            active={true}
            payload={[
              {
                value: pinValue,
                name: "portfolio",
                color: "var(--chart-3)",
                payload: {
                  ...payload,
                  value: pinValue,
                  name: "portfolio",
                  description,
                },
              },
            ]}
            label={description}
            formatter={(value) => (masked ? MASK_TEXT : formatInrCompact(value as number))}
            hideIndicator
          />
        </g>
      )}
    </g>
  )
}

/**
 * MilestonePins — renders all milestone pins for a chart.
 * This is the main export used by JourneyChart.
 */
interface MilestonePinsProps {
  milestones: Array<{
    id?: string
    date: string
    value: number
    description: string
    index: number
  }>
  slicedDates: string[]
  /** Currently active milestone date (for tooltip) */
  activeDate?: string
}

export function MilestonePins({
  milestones,
  slicedDates,
  activeDate,
}: MilestonePinsProps) {
  // Filter milestones to only those within the current sliced window
  const visibleMilestones = milestones.filter((m) => {
    const idx = slicedDates.indexOf(m.date)
    return idx !== -1
  })

  if (visibleMilestones.length === 0) return null

  return (
    <g>
      {visibleMilestones.map((milestone) => (
        <MilestonePin
          key={milestone.id ?? `${milestone.date}-${milestone.index}`}
          x={milestone.date}
          y={milestone.value}
          description={milestone.description}
          payload={{ value: milestone.value, index: milestone.index }}
          isActive={activeDate === milestone.date}
        />
      ))}
    </g>
  )
}

/**
 * Hook to track which milestone is being hovered via the chart's tooltip.
 * Since Recharts tooltip doesn't directly expose milestone hover,
 * we track it via the active tooltip label matching a milestone description.
 */
export function useMilestoneHover(
  milestones: Array<{ date: string; description: string }>,
  tooltipLabel: string | number | undefined
): string | null {
  return React.useMemo(() => {
    if (!tooltipLabel) return null
    const milestone = milestones.find((m) => m.description === String(tooltipLabel))
    return milestone?.date ?? null
  }, [milestones, tooltipLabel])
}