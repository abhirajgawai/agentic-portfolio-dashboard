"use client"

/**
 * Hero journey chart — net worth over time, stacked by platform.
 *
 * Ledger Gold redesign (2026-09-12, second pass): replaces the original
 * single-line/flat-area chart with a stacked area showing which platforms
 * are actually driving the total — a richer "trend over time" read than one
 * flat gold line hugging a near-constant total, per dataviz's own guidance
 * that line/area is the right FORM for this job; the redesign is in what
 * the area encodes (composition, not just total), not in switching to an
 * unrelated chart type. Built on ECharts (this app's existing charting
 * investment — see `docs/design/spec-ledger-gold` for why a third charting
 * library was avoided) rather than the previous @visx implementation, since
 * a multi-series stacked area with axis tooltips is ECharts' native case and
 * hand-rolling path-morph tweening for N stacked series was not worth
 * re-deriving from scratch. Straight (non-smoothed) segments are kept
 * deliberately — a snapshot is an observation, not a signal to interpolate
 * between.
 */

import { useMemo, useState } from "react"

import { EChart } from "@/components/charts/EChart"
import { journeyLinesOption, resolveThemeColor } from "@/components/charts/options"
import { PLATFORM_CHART_INDEX } from "@/components/overview/AllocationDonuts"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useGoalsData } from "@/lib/data"
import { formatInrCompact, platformLabel } from "@/lib/format"
import { usePrivacy } from "@/lib/privacy"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import type { History } from "@/types/contract"
import { DeltaChipRail } from "./DeltaChipRail"
import { EmptyGlyph } from "./EmptyGlyph"
import { formatShortDate } from "./journal"
import { useInView } from "./useInView"

export type JourneyRange = "1M" | "3M" | "6M" | "1Y" | "All"

const RANGES: ReadonlyArray<{ key: JourneyRange; days: number | null }> = [
  { key: "1M", days: 30 },
  { key: "3M", days: 91 },
  { key: "6M", days: 182 },
  { key: "1Y", days: 365 },
  { key: "All", days: null },
]

const SPARSE_THRESHOLD = 8

/** Slice every per-platform series (plus the derived total) to the trailing window. */
function sliceHistory(
  history: History,
  range: JourneyRange
): { dates: string[]; total: number[]; platforms: Array<{ id: string; data: number[] }> } {
  const days = RANGES.find((item) => item.key === range)?.days ?? null
  const dates = history.dates
  const platformIds = Object.keys(history.byPlatform).sort(
    (a, b) => (PLATFORM_CHART_INDEX[a] ?? 99) - (PLATFORM_CHART_INDEX[b] ?? 99)
  )
  const buildTotal = (start: number) => history.portfolioValueBase.slice(start)
  const buildPlatforms = (start: number) =>
    platformIds.map((id) => ({ id, data: history.byPlatform[id]!.slice(start) }))

  if (days === null || dates.length === 0) {
    return { dates, total: buildTotal(0), platforms: buildPlatforms(0) }
  }
  const last = new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime()
  const threshold = new Date(last - days * 86_400_000).toISOString().slice(0, 10)
  const start = dates.findIndex((date) => date >= threshold)
  if (start <= 0) return { dates, total: buildTotal(0), platforms: buildPlatforms(0) }
  return { dates: dates.slice(start), total: buildTotal(start), platforms: buildPlatforms(start) }
}

export function JourneyChart({ history }: { history: History }) {
  const { masked } = usePrivacy()
  const { resolvedTheme } = useTheme()
  const goalsPayload = useGoalsData().data
  const goals = useMemo(() => goalsPayload?.goals ?? [], [goalsPayload])
  const { ref, inView } = useInView<HTMLDivElement>()
  const [range, setRange] = useState<JourneyRange>("1M")

  const sliced = useMemo(() => sliceHistory(history, range), [history, range])
  const isEmpty = history.dates.length < 2
  const isShort = sliced.total.length < 2
  const mode: "sparse" | "dense" = sliced.total.length < SPARSE_THRESHOLD ? "sparse" : "dense"
  const firstDate = sliced.dates[0]
  const lastDate = sliced.dates[sliced.dates.length - 1]
  const firstValue = sliced.total[0] ?? 0
  const lastValue = sliced.total[sliced.total.length - 1] ?? 0
  const ariaLabel = masked
    ? `Net worth over time by platform, ${sliced.dates.length} data points${
        firstDate && lastDate ? ` from ${formatShortDate(firstDate)} to ${formatShortDate(lastDate)}` : ""
      }`
    : `Net worth over time by platform, from ${formatInrCompact(firstValue)} on ${
        firstDate ? formatShortDate(firstDate) : "—"
      } to ${formatInrCompact(lastValue)} on ${lastDate ? formatShortDate(lastDate) : "—"}`

  const visibleGoals = useMemo(() => {
    if (sliced.total.length === 0) return []
    const maxTotal = Math.max(...sliced.total)
    return goals.filter((goal) => Number.isFinite(goal.targetAmount) && goal.targetAmount <= maxTotal * 1.5)
  }, [goals, sliced.total])

  const option = useMemo(
    () =>
      journeyLinesOption({
        dates: sliced.dates,
        totalLabel: "Net worth",
        totalData: sliced.total,
        // resolveThemeColor(), not a raw "var(--chart-journey)" string — the
        // chart renders to <canvas>, which cannot resolve a live CSS custom
        // property the way DOM elements can (same root cause as the earlier
        // hardcoded-canvas-color fix). Passing the unresolved var() string
        // rendered as an invalid canvas color (a flat gray/white line)
        // instead of the intended bronze-gold.
        totalColor: resolveThemeColor("--chart-journey", "#B8823D"),
        series: sliced.platforms.map((p) => ({ id: p.id, label: platformLabel(p.id), data: p.data })),
        colorIndex: (id) => PLATFORM_CHART_INDEX[id] ?? 0,
        formatter: formatInrCompact,
        masked,
        goalLines: visibleGoals.map((g) => ({
          value: g.targetAmount,
          label: masked ? "Goal" : `Goal: ${formatInrCompact(g.targetAmount)}`,
        })),
      }),
    // resolvedTheme is a dependency on purpose (not read directly below) — ECharts
    // renders to canvas, so every color the option builder resolves via
    // getComputedStyle() must be recomputed whenever the theme actually
    // changes, not just when the data does (Ledger Gold final-review fix #1).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sliced, masked, visibleGoals, resolvedTheme]
  )

  const height = mode === "sparse" ? 220 : 320

  return (
    <Card className="shadow-md">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Journey</h3>
            <p className="text-[11px] text-muted-foreground">
              Net worth over time, by platform — carried-forward latest-known snapshot
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
                Only {sliced.total.length} data point{sliced.total.length === 1 ? "" : "s"} in this range — values
                carry forward until a newer snapshot is available
              </p>
            )}
            <div ref={ref} role="img" aria-label={ariaLabel} className="w-full">
              {inView ? (
                <EChart option={option} height={height} />
              ) : (
                <Skeleton className={cn("w-full", mode === "sparse" ? "h-[220px]" : "h-80")} />
              )}
            </div>
            {mode === "sparse" && <DeltaChipRail dates={sliced.dates} values={sliced.total} masked={masked} />}
          </>
        )}
      </CardContent>
    </Card>
  )
}
