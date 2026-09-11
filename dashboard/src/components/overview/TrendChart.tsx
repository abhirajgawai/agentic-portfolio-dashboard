/** Portfolio value over time — derived EOD ledger (history.json), the honest
 *  mixed-frequency series: each date sums the platforms that ran that day. */

import { useMemo } from 'react'

import { EChart } from '@/components/charts/EChart'
import { dayChangeBarOption, getChartPalette, resolveThemeColor, trendAreaOption } from '@/components/charts/options'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatInrCompact } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { useTheme } from '@/lib/theme'
import type { History } from '@/types/contract'

/** Point count above which direct labels / the day-change strip would just
 *  collide into noise — matches JourneyChart's cap. */
const LABEL_MAX_POINTS = 12
const CHANGE_STRIP_MAX_POINTS = 20

export function TrendChart({ history }: { history: History }) {
  const { masked } = usePrivacy()
  const { resolvedTheme } = useTheme()

  const option = useMemo(() => {
    const geoSeries = Object.entries(history.byGeography).map(([geo, values]) => ({
      name: geo,
      data: values,
    }))
    // Lead with the Ledger Gold accent (same token JourneyChart uses) for the
    // primary Portfolio series — the one with the area fill — so the wash
    // reads gold, not a stray saturated blue. Geography breakout lines still
    // use the sanctioned --chart-1..9 categorical palette (tokens.md leaves
    // that untouched), resolved via getChartPalette() rather than a
    // hardcoded hex array.
    const colors = [resolveThemeColor('--chart-journey', 'oklch(0.56 0.135 65)'), ...getChartPalette()]
    return trendAreaOption({
      dates: history.dates,
      series: [
        { name: 'Portfolio', data: history.portfolioValueBase, area: true },
        ...geoSeries,
      ],
      formatter: (v) => formatInrCompact(v),
      masked,
      showLabels: history.dates.length <= LABEL_MAX_POINTS,
      colors,
    })
    // resolvedTheme isn't read directly, but resolveThemeColor()/
    // getChartPalette() read live CSS custom properties off <html> — this
    // dep re-runs the memo (and repaints the canvas) on a theme toggle
    // instead of leaving stale colors until an unrelated re-render fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, masked, resolvedTheme])

  const changeOption = useMemo(() => {
    const values = history.portfolioValueBase
    if (values.length < 2 || values.length > CHANGE_STRIP_MAX_POINTS) return null
    const changes = values.slice(1).map((v, i) => v - (values[i] ?? 0))
    return dayChangeBarOption({
      dates: history.dates.slice(1),
      changes,
      formatter: (v) => formatInrCompact(v),
      masked,
    })
    // dayChangeBarOption's tooltip/axis colors come from resolveThemeColor()
    // internally — resolvedTheme forces a re-paint on theme toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, masked, resolvedTheme])

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-1">
        <CardTitle>Portfolio value over time</CardTitle>
        <CardDescription>EOD ledger, base currency</CardDescription>
      </CardHeader>
      <CardContent>
        {history.dates.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
            No history yet — snapshots accumulate from the first pipeline run
          </div>
        ) : (
          <>
            <EChart option={option} height={280} />
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