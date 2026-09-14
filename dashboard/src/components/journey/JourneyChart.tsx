"use client"

/**
 * Hero journey chart — net worth over time, by platform.
 *
 * Ledger Gold redesign (2026-09-12, third pass): matches the exact visual
 * recipe of Allocation's "Portfolio value over time" (`TrendChart.tsx`) per
 * direct user request — a bold gold `Net worth` line with a gradient area
 * fill, thin plain lines for the platform breakdown, and a separate
 * day-over-day change bar strip underneath, all built on the same
 * `trendAreaOption`/`dayChangeBarOption` builders `TrendChart.tsx` uses.
 * (Earlier passes here tried a stacked area, then an all-thin-lines chart;
 * this pass converges Journey and Allocation onto one shared chart language
 * instead of Journey having its own bespoke treatment.)
 */

import { useMemo, useState } from "react"

import { EChart } from "@/components/charts/EChart"
import { dayChangeBarOption, getChartPalette, resolveThemeColor, trendAreaOption } from "@/components/charts/options"
import { PLATFORM_CHART_INDEX } from "@/components/overview/AllocationDonuts"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useGoalsData } from "@/lib/data"
import { formatInr, platformLabel } from "@/lib/format"
import { usePrivacy } from "@/lib/privacy"
import { useTheme } from "@/lib/theme"
import type { History } from "@/types/contract"
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

/** Matches TrendChart's thresholds — labels/change-strip collide into noise past these. */
const LABEL_MAX_POINTS = 12
const CHANGE_STRIP_MAX_POINTS = 20

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
  const firstDate = sliced.dates[0]
  const lastDate = sliced.dates[sliced.dates.length - 1]
  const firstValue = sliced.total[0] ?? 0
  const lastValue = sliced.total[sliced.total.length - 1] ?? 0
  const ariaLabel = masked
    ? `Net worth over time by platform, ${sliced.dates.length} data points${
        firstDate && lastDate ? ` from ${formatShortDate(firstDate)} to ${formatShortDate(lastDate)}` : ""
      }`
    : `Net worth over time by platform, from ${formatInr(firstValue)} on ${
        firstDate ? formatShortDate(firstDate) : "—"
      } to ${formatInr(lastValue)} on ${lastDate ? formatShortDate(lastDate) : "—"}`

  const visibleGoals = useMemo(() => {
    if (sliced.total.length === 0) return []
    const maxTotal = Math.max(...sliced.total)
    return goals.filter((goal) => Number.isFinite(goal.targetAmount) && goal.targetAmount <= maxTotal * 1.5)
  }, [goals, sliced.total])

  const option = useMemo(
    () =>
      trendAreaOption({
        dates: sliced.dates,
        series: [
          { name: "Net worth", data: sliced.total, area: true },
          ...sliced.platforms.map((p) => ({ name: platformLabel(p.id), data: p.data })),
        ],
        formatter: formatInr,
        masked,
        showLabels: sliced.dates.length <= LABEL_MAX_POINTS,
        // Positional, not a colorIndex lookup — sliced.platforms is already
        // sorted by PLATFORM_CHART_INDEX (see sliceHistory above), so the
        // resolved --chart-1..9 palette lines up with the same platform ->
        // color mapping Allocation/Account Roads use.
        colors: [resolveThemeColor("--chart-journey", "#B8823D"), ...getChartPalette()],
        goalLines: visibleGoals.map((g) => ({
          value: g.targetAmount,
          label: masked ? "Goal" : `Goal: ${formatInr(g.targetAmount)}`,
        })),
      }),
    // resolvedTheme isn't read directly, but resolveThemeColor()/getChartPalette()
    // read live CSS custom properties off <html> — this dep re-runs the memo on
    // a theme toggle instead of leaving stale colors until an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sliced, masked, visibleGoals, resolvedTheme]
  )

  const changeOption = useMemo(() => {
    const values = sliced.total
    if (values.length < 2 || values.length > CHANGE_STRIP_MAX_POINTS) return null
    const changes = values.slice(1).map((v, i) => v - (values[i] ?? 0))
    return dayChangeBarOption({
      dates: sliced.dates.slice(1),
      changes,
      formatter: formatInr,
      masked,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliced, masked, resolvedTheme])

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
              {inView ? <EChart option={option} height={320} /> : <Skeleton className="h-80 w-full" />}
            </div>
            {changeOption && (
              <div className="mt-2">
                <p className="mb-1 text-[10px] text-muted-foreground">Day-over-day change</p>
                <EChart option={changeOption} height={90} />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
