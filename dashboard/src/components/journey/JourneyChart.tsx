"use client"

/**
 * Hero journey chart — portfolio value over time from history.json with a
 * Recharts ComposedChart (Area + Line), gradient fill, per-goal ReferenceLines,
 * milestone pins, range pills (1M/3M/6M/1Y/All) and a Brush for drag-to-zoom.
 *
 * Honesty: the series is the carried-forward latest-known snapshot history. Each
 * date shows the latest available value for each holding/account, so a date
 * without a new snapshot can repeat the previous known value. Goals are
 * DB-backed (goals.json via the bridge, M8.9), never ledger facts. The
 * chart is `role="img"` decoration per a11y-spec §5 — goals and milestones
 * also render as DOM list items in GoalMilestones / MilestoneJournal.
 */

import * as React from "react"
import { useMemo, useState, useCallback } from "react"
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Brush,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts"

import { ChartContainer, ChartConfig } from "@/components/ui/chart"
import { ChartCursor, ChartTooltipContent } from "@/components/ui/chart-tooltip"
import { useGoalsData } from "@/lib/data"
import { useInView } from "./useInView"
import { formatInrCompact, MASK_TEXT } from "@/lib/format"
import { formatShortDate } from "./journal"
import { usePrivacy } from "@/lib/privacy"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { History } from "@/types/contract"
import { usePrefersReducedMotion } from "./motion"
import { deriveMilestones, type Milestone } from "./journal"
import { MilestonePins, useMilestoneHover } from "./MilestonePin"

/* ------------------------------------------------------------------ */
/* Range pills                                                         */
/* ------------------------------------------------------------------ */

export type JourneyRange = "1M" | "3M" | "6M" | "1Y" | "All" | "Custom"

const RANGES: ReadonlyArray<{ key: JourneyRange; days: number | null }> = [
  { key: "1M", days: 30 },
  { key: "3M", days: 91 },
  { key: "6M", days: 182 },
  { key: "1Y", days: 365 },
  { key: "All", days: null },
]

/** Slice the ledger to the trailing window; "All" returns everything. */
function sliceHistory(history: History, range: JourneyRange): { dates: string[]; values: number[] } {
  const days = RANGES.find((r) => r.key === range)?.days ?? null
  const dates = history.dates
  if (days === null || dates.length === 0) {
    return { dates, values: history.portfolioValueBase }
  }
  const last = new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime()
  const threshold = new Date(last - days * 86_400_000).toISOString().slice(0, 10)
  const start = dates.findIndex((d) => d >= threshold)
  if (start <= 0) return { dates, values: history.portfolioValueBase }
  return {
    dates: dates.slice(start),
    values: history.portfolioValueBase.slice(start),
  }
}

/** One markPoint per ledger index — crossings outrank appearances. */
function chartMilestones(history: History): Milestone[] {
  const byIndex = new Map<number, Milestone>()
  for (const milestone of deriveMilestones(history)) {
    const existing = byIndex.get(milestone.index)
    const isCrossing = milestone.description.startsWith("Crossed")
    if (!existing || (isCrossing && !existing.description.startsWith("Crossed"))) {
      byIndex.set(milestone.index, milestone)
    }
  }
  return [...byIndex.values()]
}



/* ------------------------------------------------------------------ */
/* Chart Config                                                        */
/* ------------------------------------------------------------------ */

const chartConfig: ChartConfig = {
  portfolio: { label: "Portfolio", color: "var(--chart-1)" },
  goal: { label: "Goal", color: "var(--warning)" },
  milestone: { label: "Milestone", color: "var(--chart-3)" },
} satisfies ChartConfig

/* ------------------------------------------------------------------ */
/* Gradient Definitions (injected via ChartStyle)                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

const ANIMATION_DURATION = 800

export function JourneyChart({ history }: { history: History }) {
  const { masked } = usePrivacy()
  // Memoized so the goals array stays referentially stable across renders
  // (the `?? []` fallback would otherwise allocate fresh every render).
  const goalsPayload = useGoalsData().data
  const goals = useMemo(() => goalsPayload?.goals ?? [], [goalsPayload])
  const reduced = usePrefersReducedMotion()
  const { ref, inView } = useInView<HTMLDivElement>()

  const [range, setRange] = useState<JourneyRange>("All")
  const [brushRange, setBrushRange] = useState<{ startIndex: number; endIndex: number } | null>(null)
  const [tooltipLabel, setTooltipLabel] = useState<string | number | undefined>()

  const sliced = useMemo(() => sliceHistory(history, range), [history, range])
  const milestones = useMemo(() => chartMilestones(history), [history])

  // Build data array for Recharts
  const chartData = useMemo(() => {
    return sliced.dates.map((date, i) => ({
      date,
      value: sliced.values[i] ?? 0,
      // Include breakdown data for tooltip
      byGeography: Object.fromEntries(
        Object.entries(history.byGeography).map(([k, v]) => [k, v[i] ?? 0])
      ),
      byPlatform: Object.fromEntries(
        Object.entries(history.byPlatform).map(([k, v]) => [k, v[i] ?? 0])
      ),
    }))
  }, [sliced.dates, sliced.values, history.byGeography, history.byPlatform])

  // Compute yMax (dataMax * 1.06, goals excluded from scale)
  const yMax = useMemo(() => {
    const visibleValues = sliced.values.filter((v) => Number.isFinite(v))
    if (visibleValues.length === 0) return undefined
    const dataMax = Math.max(...visibleValues)
    return dataMax > 0 ? dataMax * 1.06 : dataMax + Math.max(Math.abs(dataMax) * 0.06, 1)
  }, [sliced.values])

  // Visible goals within yMax
  const visibleGoals = useMemo(() => {
    if (yMax === undefined) return []
    return goals.filter(
      (goal) =>
        Number.isFinite(goal.targetAmount) &&
        goal.targetAmount >= 0 &&
        goal.targetAmount <= yMax
    )
  }, [goals, yMax])

  // Milestones inside the current window
  const visibleMilestones = useMemo(() => {
    return milestones.filter((m) => sliced.dates.includes(m.date))
  }, [milestones, sliced.dates])

  // Track active milestone for pin tooltip
  const activeMilestoneDate = useMilestoneHover(visibleMilestones, tooltipLabel)

  // Handle brush change — update range pills to custom range
  const handleBrushChange = useCallback(({ startIndex, endIndex }: { startIndex: number; endIndex: number }) => {
    if (startIndex === endIndex) {
      setBrushRange(null)
      setRange("All")
      return
    }
    setBrushRange({ startIndex, endIndex })
    // Create a custom range indicator
    setRange("Custom")
  }, [])

  // Clear custom brush range
  const clearCustomRange = useCallback(() => {
    setBrushRange(null)
    setRange("All")
  }, [])

  const isEmpty = history.dates.length < 2
  const isShort = sliced.values.length < 2

  const firstDate = sliced.dates[0]
  const lastDate = sliced.dates[sliced.dates.length - 1]
  const firstValue = sliced.values[0] ?? 0
  const lastValue = sliced.values[sliced.values.length - 1] ?? 0
  const ariaLabel = masked
    ? `Net worth over time, ${sliced.dates.length} data points${
        firstDate && lastDate ? ` from ${formatShortDate(firstDate)} to ${formatShortDate(lastDate)}` : ""
      }`
    : `Net worth over time, from ${formatInrCompact(firstValue)} on ${
        firstDate ? formatShortDate(firstDate) : "—"
      } to ${formatInrCompact(lastValue)} on ${lastDate ? formatShortDate(lastDate) : "—"}`

  // Format x-axis labels (MMM DD)
  const formatXLabel = (date: string) => date.slice(5)

  // Privacy-aware formatters
  const formatYTick = (value: number) => (masked ? MASK_TEXT : formatInrCompact(value))

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Journey</h3>
            <p className="text-[11px] text-muted-foreground">
              Net worth over time — carried-forward latest-known snapshot (base currency)
            </p>
          </div>
          <div role="group" aria-label="Chart range" className="flex items-center gap-1 overflow-x-auto">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                aria-pressed={range === r.key}
                onClick={() => {
                  setRange(r.key)
                  setBrushRange(null)
                }}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  range === r.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {r.key}
              </button>
            ))}
            {brushRange && (
              <button
                type="button"
                onClick={clearCustomRange}
                aria-label="Clear custom range"
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "bg-warning text-warning-foreground flex items-center gap-1"
                )}
              >
                Custom
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {isEmpty ? (
          <div className="flex h-80 items-center justify-center text-xs text-muted-foreground">
            No history yet — snapshots accumulate from the first pipeline run
          </div>
        ) : (
          <>
            {isShort && (
              <p className="mb-2 text-[11px] text-warning">
                Only {sliced.values.length} data point{sliced.values.length === 1 ? "" : "s"} in
                this range — values carry forward until a newer snapshot is available
              </p>
            )}
            <div ref={ref} role="img" aria-label={ariaLabel} className="h-80 w-full">
              {inView ? (
                <ChartContainer config={chartConfig} className="h-full w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={chartData}
                      accessibilityLayer
                      margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
                    >
                    <defs>
                      <linearGradient id="journeyPortfolioGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      horizontal={true}
                      vertical={false}
                      strokeDasharray="4 4"
                      stroke="var(--border)"
                    />
                    <XAxis
                      dataKey="date"
                      type="category"
                      tickLine={false}
                      axisLine={{ stroke: "var(--border)" }}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                      tickFormatter={formatXLabel}
                      interval={Math.max(1, Math.floor(sliced.dates.length / 10))}
                      dy={8}
                    />
                    <YAxis
                      type="number"
                      domain={[0, yMax ?? "auto"]}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                      tickFormatter={formatYTick}
                      tickCount={5}
                      width={60}
                    />
                    <Tooltip
                      content={<ChartTooltipContent
                        formatter={(value: number | string | undefined, name: string) => {
                          if (name === "value") return masked ? MASK_TEXT : formatInrCompact(value as number)
                          return value
                        }}
                      />}
                      cursor={<ChartCursor strokeDasharray="4 4" />}
                      labelFormatter={(label: React.ReactNode) => formatXLabel(String(label)) as any}
                      wrapperStyle={{ outline: "none" }}
                      contentStyle={{
                        backgroundColor: "hsl(var(--muted))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "var(--radius)",
                        padding: "8px 12px",
                        boxShadow:
                          "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
                      }}
                      // @ts-expect-error - recharts Tooltip supports onChange at runtime but types don't include it
                      onChange={(label: string | number) => setTooltipLabel(label)}
                    />
                    {/* Brush for drag-to-zoom */}
                    <Brush
                      startIndex={brushRange?.startIndex ?? 0}
                      endIndex={brushRange?.endIndex ?? chartData.length - 1}
                      onChange={handleBrushChange}
                      fill="var(--primary)"
                      fillOpacity={0.08}
                      stroke="var(--primary)"
                      strokeWidth={1}
                      strokeDasharray="4 4"
                      className="cursor-ew-resize"
                    />
                    {/* Gradient Area (bottom layer) */}
                    <Area
                      type="linear"
                      dataKey="value"
                      fill="url(#journeyPortfolioGradient)"
                      style={{
                        animation: reduced
                          ? "none"
                          : `area-fade ${ANIMATION_DURATION}ms var(--ease-out) forwards`,
                      }}
                    />
                    {/* Goal ReferenceLines */}
                    {visibleGoals.map((goal) => (
                      <ReferenceLine
                        key={goal.id}
                        y={goal.targetAmount}
                        stroke="var(--warning)"
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                        label={{
                          position: "insideTop",
                          fill: "var(--warning)",
                          fontSize: 10,
                          formatter: () => `Goal: ${formatInrCompact(goal.targetAmount)}`,
                        }}
                      />
                    ))}
                    {/* Animated Line (top layer) */}
                    <Line
                      type="linear"
                      dataKey="value"
                      stroke="var(--chart-1)"
                      strokeWidth={2.5}
                      dot={sliced.values.length <= 12}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        animation: reduced
                          ? "none"
                          : `line-draw ${ANIMATION_DURATION}ms var(--ease-out) forwards`,
                      }}
                    />
                    {/* Milestone Pins */}
                    <MilestonePins
                      milestones={visibleMilestones}
                      slicedDates={sliced.dates}
                      activeDate={activeMilestoneDate ?? undefined}
                    />
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartContainer>
              ) : (
                <Skeleton className="h-80 w-full" />
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
