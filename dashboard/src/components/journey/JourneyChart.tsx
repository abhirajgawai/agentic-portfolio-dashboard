"use client"

/**
 * Hero journey chart — a deterministic, static SVG of the carried-forward
 * portfolio value history.  The chart deliberately uses straight segments:
 * snapshots are observations, not a signal to interpolate between.
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from "react"
import { scaleLinear, scaleUtc } from "@visx/scale"
import { AreaClosed, LinePath } from "@visx/shape"
import { LinearGradient } from "@visx/gradient"
import { curveLinear } from "@visx/curve"
import { interpolatePath } from "d3-interpolate-path"
import { animate } from "motion"

import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { ChartTooltipContent } from "@/components/ui/chart-tooltip"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
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
import { clampedLabelAnchor, MilestonePins, selectVisibleMilestoneLabels, useMilestoneHover } from "./MilestonePin"
import { DeltaChipRail } from "./DeltaChipRail"
import { EmptyGlyph } from "./EmptyGlyph"

export type JourneyRange = "1M" | "3M" | "6M" | "1Y" | "All"

const RANGES: ReadonlyArray<{ key: JourneyRange; days: number | null }> = [
  { key: "1M", days: 30 },
  { key: "3M", days: 91 },
  { key: "6M", days: 182 },
  { key: "1Y", days: 365 },
  { key: "All", days: null },
]

/** Observe the content box so the SVG has a real width without a chart library. */
function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    setWidth(element.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [ref])

  return width
}

/** Slice the ledger to the trailing window; "All" returns everything. */
function sliceHistory(history: History, range: JourneyRange): { dates: string[]; values: number[] } {
  const days = RANGES.find((item) => item.key === range)?.days ?? null
  const dates = history.dates
  if (days === null || dates.length === 0) {
    return { dates, values: history.portfolioValueBase }
  }
  const last = new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime()
  const threshold = new Date(last - days * 86_400_000).toISOString().slice(0, 10)
  const start = dates.findIndex((date) => date >= threshold)
  if (start <= 0) return { dates, values: history.portfolioValueBase }
  return {
    dates: dates.slice(start),
    values: history.portfolioValueBase.slice(start),
  }
}

const chartConfig: ChartConfig = {
  portfolio: { label: "Portfolio", color: "var(--chart-journey)" },
  goal: { label: "Goal", color: "var(--warning)" },
  milestone: { label: "Milestone", color: "var(--chart-journey)" },
} satisfies ChartConfig

const PATH_MORPH_DURATION_MS = 400
const SPARSE_PATH_MORPH_DURATION_MS = 300
const SPARSE_THRESHOLD = 8
const PATH_MORPH_EASE = [0.16, 1, 0.3, 1] as const

type ChartPoint = { date: string; parsedDate: Date; value: number }

function chartMilestones(milestones: Milestone[]): Milestone[] {
  const byIndex = new Map<number, Milestone>()
  for (const milestone of milestones) {
    const current = byIndex.get(milestone.index)
    const crossing = milestone.description.startsWith("Crossed")
    if (!current || crossing || !current.description.startsWith("Crossed")) byIndex.set(milestone.index, milestone)
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index)
}

export function JourneyChart({ history }: { history: History }) {
  const { masked } = usePrivacy()
  const goalsPayload = useGoalsData().data
  const goals = useMemo(() => goalsPayload?.goals ?? [], [goalsPayload])
  const { ref, inView } = useInView<HTMLDivElement>()
  const width = useElementWidth(ref)
  // Robinhood-style default: a short window, not lifetime "All" — as more
  // daily snapshots accumulate this naturally zooms into recent detail
  // instead of always being dominated by the since-inception ramp.
  const [range, setRange] = useState<JourneyRange>("1M")
  const reduced = usePrefersReducedMotion()
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  const linePathRef = useRef<SVGPathElement | null>(null)
  const areaPathRef = useRef<SVGPathElement | null>(null)
  const lineDRef = useRef("")
  const areaDRef = useRef("")
  const nextLineDRef = useRef("")
  const nextAreaDRef = useRef("")
  const committedRangeRef = useRef<JourneyRange | null>(null)
  const animationRef = useRef<{ stop: () => void } | null>(null)
  const animationGenerationRef = useRef(0)
  const committedModeRef = useRef<"sparse" | "dense" | null>(null)
  const previousModeRef = useRef<"sparse" | "dense" | null>(null)
  const geometrySyncRangeRef = useRef<JourneyRange | null>(null)
  const [modeVisible, setModeVisible] = useState(true)

  const sliced = useMemo(() => sliceHistory(history, range), [history, range])
  const chartData = useMemo<ChartPoint[]>(
    () =>
      sliced.dates.map((date, index) => ({
        date,
        parsedDate: new Date(`${date}T00:00:00Z`),
        value: sliced.values[index] ?? 0,
      })),
    [sliced.dates, sliced.values]
  )
  // Dynamic Y-domain (not anchored to 0): trading-app-style charts scale to the
  // visible data range so day-to-day moves (~1% on a Cr-scale portfolio) read
  // as real zig-zags instead of a near-flat line pinned against a 0 floor.
  const yDomain = useMemo<[number, number] | undefined>(() => {
    const values = sliced.values.filter((value) => Number.isFinite(value))
    if (values.length === 0) return undefined
    const dataMin = Math.min(...values)
    const dataMax = Math.max(...values)
    const range = dataMax - dataMin
    const pad = range > 0 ? range * 0.15 : Math.max(Math.abs(dataMax) * 0.06, 1)
    return [Math.max(0, dataMin - pad), dataMax + pad]
  }, [sliced.values])
  const yMax = yDomain?.[1]
  const visibleGoals = useMemo(
    () =>
      yDomain === undefined
        ? []
        : goals.filter(
            (goal) =>
              Number.isFinite(goal.targetAmount) && goal.targetAmount >= yDomain[0] && goal.targetAmount <= yDomain[1]
          ),
    [goals, yDomain]
  )

  const isEmpty = history.dates.length < 2
  const isShort = sliced.values.length < 2
  const mode: "sparse" | "dense" = sliced.values.length < SPARSE_THRESHOLD ? "sparse" : "dense"
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

  const formatYTick = (value: number) => (masked ? MASK_TEXT : formatInrCompact(value))
  const formatXLabel = (date: string) => date.slice(5)
  const height = mode === "sparse" ? 220 : 320
  const margin = mode === "sparse"
    ? { top: 24, right: 16, bottom: 8, left: 16 }
    : { top: 10, right: 10, bottom: 0, left: 0 }
  const xDomain = useMemo<[Date, Date]>(() => {
    const first = chartData[0]?.parsedDate
    const last = chartData.at(-1)?.parsedDate
    if (!first || !last) return [new Date(0), new Date(86_400_000)]
    if (first.getTime() !== last.getTime()) return [first, last]

    // scaleUtc needs a non-degenerate domain. A symmetric day of padding keeps
    // a one-point/equal-date series centered without inventing another datum.
    const padding = 12 * 60 * 60 * 1000
    return [new Date(first.getTime() - padding), new Date(last.getTime() + padding)]
  }, [chartData])
  const plotWidth = Math.max(width, 1)
  const xScale = scaleUtc({
    domain: xDomain,
    range: [margin.left, plotWidth - margin.right],
  })
  const yScale = scaleLinear({
    domain: yDomain ?? [0, 1],
    range: [height - margin.bottom, margin.top],
  })
  const dense = mode === "dense"
  const yTicks = yScale.ticks(dense ? 6 : 5)
  const xStep = Math.max(1, Math.ceil(chartData.length / 10))
  const showPoints = dense && chartData.length <= 12
  // Ledger Gold: a single bronze-gold accent for the whole line/area, not a
  // per-range gain/loss color swap — day-to-day direction is still legible
  // via the gain/loss-colored delta chips, tooltip, and YearStrip elsewhere
  // on this page; the trend line itself reads as one consistent brand mark.
  const trendColor = "var(--chart-journey)"
  const allMilestones = useMemo(() => chartMilestones(deriveMilestones(history)), [history])
  const visibleMilestones = useMemo(() => {
    const start = sliced.dates[0]
    const end = sliced.dates.at(-1)
    return allMilestones.filter((milestone) => (!start || milestone.date >= start) && (!end || milestone.date <= end))
  }, [allMilestones, sliced.dates])
  const [tooltip, setTooltip] = useState<{
    point: ChartPoint
    x: number
    y: number
  } | null>(null)
  const tooltipMilestoneDate = useMilestoneHover(allMilestones, tooltip?.point.date)
  const activeMilestoneDate = visibleMilestones.some((milestone) => milestone.date === tooltip?.point.date)
    ? tooltip?.point.date
    : tooltipMilestoneDate
  const significantMilestoneDates = useMemo(() => {
    const labeledIds = selectVisibleMilestoneLabels(visibleMilestones, xScale)
    return new Set(visibleMilestones.filter((m) => labeledIds.has(m.id)).map((m) => m.date))
  }, [visibleMilestones, xScale])
  const latestHistoryDate = history.dates.at(-1)
  const justCrossedDate = latestHistoryDate
    ? allMilestones.find((milestone) => milestone.date === latestHistoryDate)?.date ?? null
    : null

  const handlePointerMove = (event: PointerEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg || chartData.length === 0) return
    const bounds = svg.getBoundingClientRect()
    const localX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * plotWidth
    let nearest = chartData[0]!
    let nearestDistance = Math.abs(xScale(nearest.parsedDate) - localX)
    for (const point of chartData.slice(1)) {
      const distance = Math.abs(xScale(point.parsedDate) - localX)
      if (distance < nearestDistance) {
        nearest = point
        nearestDistance = distance
      }
    }
    setTooltip({ point: nearest, x: xScale(nearest.parsedDate), y: yScale(nearest.value) })
  }

  useEffect(() => {
    const modeChanged = committedModeRef.current !== null && committedModeRef.current !== mode
    const lineElement = linePathRef.current
    const areaElement = areaPathRef.current
    const nextLineD = nextLineDRef.current
    const nextAreaD = nextAreaDRef.current
    const previousLineD = lineDRef.current || nextLineD
    const previousAreaD = areaDRef.current || nextAreaD

    // Preserve the exact in-flight shape before interrupting it. The next
    // range then morphs from what is visible, not from an older completed d.
    const previousAnimation = animationRef.current
    animationRef.current = null
    animationGenerationRef.current += 1
    previousAnimation?.stop()

    const shouldMorph = committedRangeRef.current !== null && committedRangeRef.current !== range && !modeChanged && !reducedRef.current
    if (!shouldMorph) {
      lineDRef.current = nextLineD
      areaDRef.current = nextAreaD
      lineElement?.setAttribute("d", nextLineD)
      areaElement?.setAttribute("d", nextAreaD)
    } else {
      const lineInterpolator = interpolatePath(previousLineD, nextLineD)
      const areaInterpolator = interpolatePath(previousAreaD, nextAreaD)
      const generation = animationGenerationRef.current
      animationRef.current = animate(0, 1, {
        duration: (mode === "sparse" ? SPARSE_PATH_MORPH_DURATION_MS : PATH_MORPH_DURATION_MS) / 1000,
        ease: PATH_MORPH_EASE,
        onUpdate: (t) => {
          if (animationGenerationRef.current !== generation) return
          const lineD = lineInterpolator(t)
          const areaD = areaInterpolator(t)
          lineDRef.current = lineD
          areaDRef.current = areaD
          linePathRef.current?.setAttribute("d", lineD)
          areaPathRef.current?.setAttribute("d", areaD)
        },
        onComplete: () => {
          if (animationGenerationRef.current !== generation) return
          lineDRef.current = nextLineD
          areaDRef.current = nextAreaD
          animationRef.current = null
        },
      })
    }
    committedRangeRef.current = range
    committedModeRef.current = mode

    return () => {
      // Stopping must not snap back to the old range's target. Capture the
      // displayed interpolation as the committed source for the next effect.
      const displayedLineD = lineElement?.getAttribute("d")
      const displayedAreaD = areaElement?.getAttribute("d")
      if (displayedLineD) lineDRef.current = displayedLineD
      if (displayedAreaD) areaDRef.current = displayedAreaD
      const activeAnimation = animationRef.current
      animationRef.current = null
      animationGenerationRef.current += 1
      activeAnimation?.stop()
    }
  }, [range, mode])

  useEffect(() => {
    // Geometry changes (resize, scale changes, or same-range refetches) must
    // replace both paths directly. The range effect above owns morphs; skip
    // this effect's first run for each new range so it cannot cancel one.
    if (geometrySyncRangeRef.current !== null && geometrySyncRangeRef.current !== range) {
      geometrySyncRangeRef.current = range
      return
    }
    geometrySyncRangeRef.current = range

    const activeAnimation = animationRef.current
    animationRef.current = null
    animationGenerationRef.current += 1
    activeAnimation?.stop()

    const latestLineD = nextLineDRef.current
    const latestAreaD = nextAreaDRef.current
    lineDRef.current = latestLineD
    areaDRef.current = latestAreaD
    linePathRef.current?.setAttribute("d", latestLineD)
    areaPathRef.current?.setAttribute("d", latestAreaD)
  }, [chartData, height, margin.bottom, margin.left, margin.right, margin.top, plotWidth, range, yMax])

  useEffect(() => {
    if (previousModeRef.current === null) {
      previousModeRef.current = mode
      return
    }
    if (previousModeRef.current === mode) return
    previousModeRef.current = mode
    if (reduced) {
      setModeVisible(true)
      return
    }
    setModeVisible(false)
    const frame = requestAnimationFrame(() => setModeVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [mode, reduced])

  useEffect(() => {
    if (!reduced) return
    const activeAnimation = animationRef.current
    animationRef.current = null
    animationGenerationRef.current += 1
    activeAnimation?.stop()

    const latestLineD = nextLineDRef.current
    const latestAreaD = nextAreaDRef.current
    lineDRef.current = latestLineD
    areaDRef.current = latestAreaD
    linePathRef.current?.setAttribute("d", latestLineD)
    areaPathRef.current?.setAttribute("d", latestAreaD)
  }, [reduced])

  return (
    <Card className="shadow-md">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Journey</h3>
            <p className="text-[11px] text-muted-foreground">
              Net worth over time — carried-forward latest-known snapshot (base currency)
            </p>
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={range}
            onValueChange={(value) => value && setRange(value as JourneyRange)}
            aria-label="Chart range"
          >
            {RANGES.map((item) => (
              <ToggleGroupItem key={item.key} value={item.key} aria-label={item.key}>
                {item.key}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {isEmpty ? (
          <div className="flex h-80 items-center justify-center text-xs text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <EmptyGlyph className="h-10 w-16" />
              <span>No history yet — snapshots accumulate from the first pipeline run</span>
            </div>
          </div>
        ) : (
          <>
            {isShort && (
              <p className="mb-2 text-[11px] text-warning">
                Only {sliced.values.length} data point{sliced.values.length === 1 ? "" : "s"} in this range — values carry forward until a newer snapshot is available
              </p>
            )}
            <div ref={ref} role="img" aria-label={ariaLabel} className={cn("w-full", mode === "sparse" ? "h-[220px]" : "h-80")}>
              {inView && width > 0 ? (
                <ChartContainer config={chartConfig} className="h-full w-full">
                    <div className={cn("relative h-full w-full transition-opacity duration-150 motion-reduce:transition-none", modeVisible ? "opacity-100" : "opacity-0")}>
                    <svg width={plotWidth} height={height} viewBox={`0 0 ${plotWidth} ${height}`} className="block" aria-hidden="true">
                       <defs>
                        <LinearGradient
                          id="journey-area-gradient"
                          from={trendColor}
                          to={trendColor}
                          fromOpacity={0.45}
                          toOpacity={0}
                        >
                          <stop offset="0%" stopColor={trendColor} stopOpacity={0.45} />
                          <stop offset="55%" stopColor={trendColor} stopOpacity={0.18} />
                          <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                        </LinearGradient>
                         <filter id="journey-glow" x="-50%" y="-50%" width="200%" height="200%">
                           <feGaussianBlur stdDeviation="3" result="blur1" />
                           <feGaussianBlur stdDeviation="7" in="SourceGraphic" result="blur2" />
                           <feMerge>
                             <feMergeNode in="blur2" />
                             <feMergeNode in="blur1" />
                             <feMergeNode in="SourceGraphic" />
                           </feMerge>
                         </filter>
                       </defs>
                       {dense && yTicks.map((tick) => {
                        const y = yScale(tick)
                        return (
                          <g key={tick}>
                            <line x1={margin.left} x2={plotWidth - margin.right} y1={y} y2={y} stroke="var(--border)" strokeDasharray="4 4" />
                            <text x={margin.left + 4} y={y - 4} fill="var(--muted-foreground)" fontSize={11}>{formatYTick(tick)}</text>
                          </g>
                        )
                      })}
                      {visibleGoals.map((goal) => {
                        const y = yScale(goal.targetAmount)
                        return (
                          <g key={goal.id}>
                            <line x1={margin.left} x2={plotWidth - margin.right} y1={y} y2={y} stroke="var(--warning)" strokeDasharray="4 4" strokeWidth={1.5} />
                            <text x={plotWidth - margin.right - 4} y={y - 4} textAnchor="end" fill="var(--warning)" fontSize={10}>
                              {masked ? "Goal" : `Goal: ${formatInrCompact(goal.targetAmount)}`}
                            </text>
                          </g>
                        )
                      })}
                       <AreaClosed<ChartPoint>
                         data={chartData}
                        x={(point) => xScale(point.parsedDate)}
                        y={(point) => yScale(point.value)}
                        yScale={yScale}
                         curve={curveLinear}
                         fill="url(#journey-area-gradient)"
                       >
                          {({ path }) => {
                            const nextD = path(chartData) ?? ""
                            nextAreaDRef.current = nextD
                            return <path ref={areaPathRef} d={areaDRef.current || nextD} fill="url(#journey-area-gradient)" />
                          }}
                       </AreaClosed>
                      <LinePath<ChartPoint>
                        data={chartData}
                        x={(point) => xScale(point.parsedDate)}
                        y={(point) => yScale(point.value)}
                        curve={curveLinear}
                        stroke={trendColor}
                         strokeWidth={2.5}
                         strokeLinecap="round"
                         strokeLinejoin="round"
                         filter="url(#journey-glow)"
                       >
                           {({ path }) => {
                            const nextD = path(chartData) ?? ""
                            nextLineDRef.current = nextD
                            return (
                             <path
                               ref={linePathRef}
                               d={lineDRef.current || nextD}
                               fill="none"
                               stroke={trendColor}
                               strokeWidth={2.5}
                               strokeLinecap="round"
                               strokeLinejoin="round"
                               filter="url(#journey-glow)"
                             />
                           )
                         }}
                       </LinePath>
                        {chartData.slice(0, -1).map((point) => {
                         if (dense && !showPoints) return null
                         const x = xScale(point.parsedDate)
                         const y = yScale(point.value)
                         const hasMilestoneLabel = significantMilestoneDates.has(point.date)
                         const valueAnchor = clampedLabelAnchor(x, plotWidth)
                         return (
                           <g key={point.date}>
                             <circle cx={x} cy={y} r={dense ? 3 : 5} fill={trendColor} filter={!dense ? "url(#journey-glow)" : undefined} />
                             {!masked && !hasMilestoneLabel && <text x={valueAnchor.x} y={dense ? y - 10 : y - 12} textAnchor={valueAnchor.textAnchor} fill="var(--foreground)" fontSize={11} fontWeight={600}>{formatInrCompact(point.value)}</text>}
                             {!dense && <text x={x} y={y + 18} textAnchor="middle" fill="var(--muted-foreground)" fontSize={10}>{formatXLabel(point.date)}</text>}
                           </g>
                         )
                       })}
                       {chartData.at(-1) && (() => {
                         const point = chartData.at(-1)!
                         const x = xScale(point.parsedDate)
                         const y = yScale(point.value)
                         const hasMilestoneLabel = significantMilestoneDates.has(point.date)
                         const valueAnchor = clampedLabelAnchor(x, plotWidth)
                         return (
                            <g key={`today-${point.date}`}>
                             {!reduced && (
                               <circle
                                 cx={x}
                                 cy={y}
                                 r={4}
                                 fill={trendColor}
                                 opacity={0.4}
                                 filter="url(#journey-glow)"
                                 style={{ animation: "journey-pulse-ring 1.8s var(--ease-out) infinite" }}
                               />
                             )}
                              <circle cx={x} cy={y} r={dense ? 3 : 5} fill={trendColor} filter="url(#journey-glow)" />
                              {!masked && !hasMilestoneLabel && <text x={valueAnchor.x} y={dense ? y - 10 : y - 12} textAnchor={valueAnchor.textAnchor} fill="var(--foreground)" fontSize={11} fontWeight={600}>{formatInrCompact(point.value)}</text>}
                              {!dense && <text x={x} y={y + 18} textAnchor="middle" fill="var(--muted-foreground)" fontSize={10}>{formatXLabel(point.date)}</text>}
                           </g>
                         )
                        })()}
                       <MilestonePins
                         milestones={visibleMilestones}
                         xScale={xScale}
                         yScale={yScale}
                         plotWidth={plotWidth}
                         activeDate={activeMilestoneDate ?? undefined}
                         justCrossedDate={justCrossedDate}
                       />
                        {dense && chartData.map((point, index) =>
                        index % xStep === 0 ? (
                          <text key={`x-${point.date}`} x={xScale(point.parsedDate)} y={height - 4} textAnchor="middle" fill="var(--muted-foreground)" fontSize={11}>
                            {formatXLabel(point.date)}
                          </text>
                        ) : null
                       )}
                       <rect
                         x={0}
                         y={0}
                         width={plotWidth}
                         height={height}
                         fill="transparent"
                         onPointerMove={handlePointerMove}
                         onPointerLeave={() => setTooltip(null)}
                         style={{ cursor: "crosshair", pointerEvents: "all" }}
                       />
                      </svg>
                     {tooltip && (
                       <div
                         className="pointer-events-none absolute z-10"
                         style={{
                           left: Math.min(Math.max(tooltip.x + 10, 0), Math.max(plotWidth - 170, 0)),
                           top: Math.max(tooltip.y - 70, 0),
                         }}
                       >
                         <ChartTooltipContent
                           active
                           label={formatShortDate(tooltip.point.date)}
                           payload={[{
                             value: tooltip.point.value,
                             name: "portfolio",
                             color: "var(--chart-journey)",
                             payload: { name: "portfolio", value: tooltip.point.value },
                           }]}
                           formatter={(value) => masked ? MASK_TEXT : formatInrCompact(Number(value))}
                         />
                       </div>
                     )}
                    </div>
                 </ChartContainer>
              ) : (
                 <Skeleton className={cn("w-full", mode === "sparse" ? "h-[220px]" : "h-80")} />
              )}
            </div>
            {mode === "sparse" && <DeltaChipRail dates={sliced.dates} values={sliced.values} masked={masked} />}
          </>
        )}
      </CardContent>
    </Card>
  )
}
