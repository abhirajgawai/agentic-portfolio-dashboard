/** Portfolio value over time — derived EOD ledger (history.json), the honest
 *  mixed-frequency series: each date sums the platforms that ran that day. */

import { useMemo } from 'react'

import { EChart } from '@/components/charts/EChart'
import { trendAreaOption, dayChangeBarOption } from '@/components/charts/options'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatInrCompact } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import type { History } from '@/types/contract'

/** Point count above which direct labels / the day-change strip would just
 *  collide into noise — matches JourneyChart's cap. */
const LABEL_MAX_POINTS = 12
const CHANGE_STRIP_MAX_POINTS = 20

export function TrendChart({ history }: { history: History }) {
  const { masked } = usePrivacy()

  const option = useMemo(() => {
    const geoSeries = Object.entries(history.byGeography).map(([geo, values]) => ({
      name: geo,
      data: values,
    }))
    return trendAreaOption({
      dates: history.dates,
      series: [
        { name: 'Portfolio', data: history.portfolioValueBase, area: true },
        ...geoSeries,
      ],
      formatter: (v) => formatInrCompact(v),
      masked,
      showLabels: history.dates.length <= LABEL_MAX_POINTS,
    })
  }, [history, masked])

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
  }, [history, masked])

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-muted-foreground">
          Portfolio value over time (EOD ledger, base currency)
        </CardTitle>
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