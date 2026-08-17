/** Returns screen — per-holding return bars (cost-bearing only), portfolio
 *  trend line, and XIRR per-account cards (M5, honest about missing flows). */

import { useMemo } from 'react'

import { EChart } from '@/components/charts/EChart'
import { returnBarsOption } from '@/components/charts/options'
import { TrendChart } from '@/components/overview/TrendChart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ErrorState, LoadingState } from '@/components/layout/states'
import { formatInrCompact, formatPct } from '@/lib/format'
import { useHistory, useLatest, useXirr } from '@/lib/data'
import { simpleReturn } from '@/lib/returns'
import type { Xirr } from '@/types/contract'
import { cn } from '@/lib/utils'

function XirrCards({ xirr }: { xirr: Xirr | undefined }) {
  const accounts = Object.entries(xirr?.perAccount ?? {})
  if (accounts.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-xs text-muted-foreground">XIRR by account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            No captured trades yet — daily trade capture has been running since M4, but the
            production DB currently has zero trade rows. XIRR is never estimated from
            snapshot deltas; it reports real flows only.
          </p>
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {accounts.map(([key, entry]) => (
        <Card key={key}>
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-mono">{key}</span>
              <Badge variant="outline" className="font-normal">
                {entry.currency}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                'text-2xl font-semibold tabular-nums',
                entry.xirrPct !== null && entry.xirrPct >= 0
                  ? 'text-gain'
                  : entry.xirrPct !== null
                    ? 'text-loss'
                    : 'text-muted-foreground',
              )}
            >
              {entry.xirrPct === null ? '—' : formatPct(entry.xirrPct)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Terminal value {formatInrCompact(entry.terminalValue)} · {entry.flowCount} flows
              {entry.xirrPct === null && ' (flows captured, rate not yet computable)'}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ReturnBars() {
  const latest = useLatest()

  const data = useMemo(() => {
    const holdings = latest.data?.holdings ?? []
    const costBearing = holdings
      .filter((h) => h.returnPct !== null)
      .sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0))
    return {
      labels: costBearing.map((h) => h.ticker),
      values: costBearing.map((h) => h.returnPct as number),
      count: costBearing.length,
    }
  }, [latest.data])

  const option = useMemo(
    () =>
      returnBarsOption({
        labels: data.labels,
        values: data.values,
      }),
    [data],
  )

  if (latest.isLoading) return null
  if (data.count === 0) {
    return (
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-xs text-muted-foreground">Per-holding returns</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            No cost-bearing holdings to chart (returns need a cost basis).
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-muted-foreground">
          Per-holding return (cost-bearing only, {data.count} holdings)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <EChart option={option} height={Math.min(480, Math.max(240, data.count * 9))} />
      </CardContent>
    </Card>
  )
}

function ReturnSummaryCard() {
  const latest = useLatest()
  const ret = latest.data ? simpleReturn(latest.data.holdings) : null
  if (!latest.data || !ret) return null
  return (
    <Card className="flex items-center justify-between p-4">
      <div>
        <CardTitle className="text-xs text-muted-foreground">Portfolio simple return</CardTitle>
        <div
          className={cn(
            'mt-2 text-2xl font-semibold tabular-nums',
            ret.pct !== null && ret.pct >= 0 ? 'text-gain' : ret.pct !== null ? 'text-loss' : 'text-muted-foreground',
          )}
        >
          {formatPct(ret.pct)}
        </div>
      </div>
      <p className="max-w-52 text-right text-xs text-muted-foreground">
        {ret.withCost} holdings with cost basis · {ret.noCost} without (CAS value-only rows
        have no cost, so they are excluded from return math)
      </p>
    </Card>
  )
}

export function ReturnsScreen() {
  const latest = useLatest()
  const history = useHistory()
  const xirr = useXirr()

  if (latest.isLoading || history.isLoading || xirr.isLoading) {
    return <LoadingState label="Loading returns…" />
  }
  if (latest.isError || history.isError || xirr.isError) {
    const firstError = latest.error ?? history.error ?? xirr.error
    return (
      <ErrorState
        message={firstError instanceof Error ? firstError.message : String(firstError)}
        onRetry={() => {
          void latest.refetch()
          void history.refetch()
          void xirr.refetch()
        }}
      />
    )
  }
  if (!latest.data || !history.data || !xirr.data) return null

  return (
    <div className="space-y-4">
      <ReturnSummaryCard />
      <ReturnBars />
      <TrendChart history={history.data} />
      <XirrCards xirr={xirr.data} />
    </div>
  )
}