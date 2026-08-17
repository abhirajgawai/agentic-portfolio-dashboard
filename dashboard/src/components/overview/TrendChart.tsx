/** Portfolio value over time — derived EOD ledger (history.json), the honest
 *  mixed-frequency series: each date sums the platforms that ran that day. */

import { useMemo } from 'react'

import { EChart } from '@/components/charts/EChart'
import { trendAreaOption } from '@/components/charts/options'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatInrCompact } from '@/lib/format'
import type { History } from '@/types/contract'

export function TrendChart({ history }: { history: History }) {
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
    })
  }, [history])

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
          <EChart option={option} height={280} />
        )}
      </CardContent>
    </Card>
  )
}