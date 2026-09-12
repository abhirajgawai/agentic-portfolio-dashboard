/**
 * Manual equities trend — Groww Equities and Sharekhan, tracked as separate
 * daily series (history.byAccount["groww:manual"] / ["sharekhan:manual"]).
 *
 * These two legs were previously invisible in every chart: the Journey/
 * Allocation per-platform lines only ever showed byPlatform.groww, which
 * SUMS the automated CAS/MF leg ("groww:folio") together with this
 * hand-entered equities total — so entering a fresh value here every day
 * was genuinely being tracked (position_snapshot upserts one row per date,
 * see manual_holdings.set_value()), just never surfaced as its own line
 * anywhere. This chart is that missing view, placed on the page that
 * actually manages these two values.
 */

import { useMemo } from 'react'

import { EChart } from '@/components/charts/EChart'
import { getChartPalette, trendAreaOption } from '@/components/charts/options'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useHistory } from '@/lib/data'
import { formatInrCompact } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { useTheme } from '@/lib/theme'

const ACCOUNT_LABELS: Record<string, string> = {
  'groww:manual': 'Groww Equities',
  'sharekhan:manual': 'Sharekhan',
}

export function ManualEquitiesTrendChart() {
  const { data: history, isLoading, isError } = useHistory()
  const { masked } = usePrivacy()
  const { resolvedTheme } = useTheme()

  const option = useMemo(() => {
    if (!history) return null
    const accountIds = Object.keys(ACCOUNT_LABELS).filter((id) => id in history.byAccount)
    if (accountIds.length === 0) return null
    return trendAreaOption({
      dates: history.dates,
      series: accountIds.map((id) => ({ name: ACCOUNT_LABELS[id]!, data: history.byAccount[id]! })),
      formatter: formatInrCompact,
      masked,
      colors: getChartPalette(),
    })
    // resolvedTheme isn't read directly, but resolveThemeColor()/getChartPalette()
    // read live CSS custom properties off <html> — this dep re-runs the memo on
    // a theme toggle instead of leaving stale colors until an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, masked, resolvedTheme])

  if (isLoading || isError || !history || history.dates.length === 0 || !option) return null

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-1">
        <CardTitle>Manual equities trend</CardTitle>
        <CardDescription>
          Groww Equities and Sharekhan, tracked from your daily entries above — separate from Groww's mutual
          fund total
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EChart option={option} height={220} />
      </CardContent>
    </Card>
  )
}
