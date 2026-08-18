/** Returns screen — per-holding return bars (cost-bearing only), portfolio
 *  trend line, and XIRR per-account cards (M5, honest about missing flows).
 *  Includes geography filter (India / US / All) + asset class filter (ETF/MF/Equity). */

import { useMemo, useState } from 'react'

import { EChart } from '@/components/charts/EChart'
import { returnBarsOption } from '@/components/charts/options'
import { TrendChart } from '@/components/overview/TrendChart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ErrorState, LoadingState } from '@/components/layout/states'
import { formatInrCompact, formatPct, MASK_TEXT, assetClassLabel } from '@/lib/format'
import { useHistory, useLatest, useXirr } from '@/lib/data'
import { simpleReturn } from '@/lib/returns'
import { usePrivacy } from '@/lib/privacy'
import type { Xirr } from '@/types/contract'
import { cn } from '@/lib/utils'

const GEOGRAPHIES = ['all', 'IN', 'US'] as const
type GeographyFilter = (typeof GEOGRAPHIES)[number]

const ASSET_CLASSES = ['all', 'etf', 'mutual_fund', 'equity', 'stock'] as const
type AssetClassFilter = (typeof ASSET_CLASSES)[number] | string

function XirrCards({ xirr }: { xirr: Xirr | undefined }) {
  const { masked } = usePrivacy()
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
              Terminal value {masked ? MASK_TEXT : formatInrCompact(entry.terminalValue)} · {entry.flowCount} flows
              {entry.xirrPct === null && ' (flows captured, rate not yet computable)'}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ReturnBars({ geography, assetClass }: { geography: GeographyFilter; assetClass: AssetClassFilter }) {
  const latest = useLatest()

  const data = useMemo(() => {
    const holdings = latest.data?.holdings ?? []
    const costBearing = holdings
      .filter((h) => h.returnPct !== null)
      .filter((h) => geography === 'all' || h.geography === geography)
      .filter((h) => assetClass === 'all' || h.assetClass === assetClass)
      .sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0))
    return {
      labels: costBearing.map((h) => h.ticker),
      values: costBearing.map((h) => h.returnPct as number),
      count: costBearing.length,
    }
  }, [latest.data, geography, assetClass])

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

function ReturnSummaryCard({ geography, assetClass }: { geography: GeographyFilter; assetClass: AssetClassFilter }) {
  const latest = useLatest()
  const holdings = latest.data?.holdings ?? []
  const filteredHoldings = holdings
    .filter((h) => geography === 'all' || h.geography === geography)
    .filter((h) => assetClass === 'all' || h.assetClass === assetClass)
  const ret = filteredHoldings.length > 0 ? simpleReturn(filteredHoldings) : null
  if (!latest.data || !ret) return null
  return (
    <Card className="flex items-center justify-between p-4">
      <div>
        <CardTitle className="text-xs text-muted-foreground">
          Portfolio simple return ({geography === 'all' ? 'All' : geography} / {assetClass === 'all' ? 'All' : assetClassLabel(assetClass)})
        </CardTitle>
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
  const [geography, setGeography] = useState<GeographyFilter>('all')
  const [assetClass, setAssetClass] = useState<AssetClassFilter>('all')

  // Dynamic asset classes based on selected geography
  const availableAssetClasses = useMemo(() => {
    const holdings = latest.data?.holdings ?? []
    const base = geography === 'all'
      ? holdings
      : holdings.filter((h) => h.geography === geography)
    const classes = new Set(base.map((h) => h.assetClass).filter((c): c is string => c !== null))
    return ['all', ...Array.from(classes).sort()] as const
  }, [latest.data, geography])

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
      {/* Geography filter */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-1">
        {GEOGRAPHIES.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => {
              setGeography(g)
              // Reset asset class when geography changes
              if (g !== geography) setAssetClass('all')
            }}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              geography === g
                ? 'bg-background text-foreground shadow'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {g === 'all' ? 'All' : g}
          </button>
        ))}
        {/* Asset Class filter — dynamic based on selected geography */}
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1 ml-2">
          {availableAssetClasses.map((ac) => (
            <button
              key={ac}
              type="button"
              onClick={() => setAssetClass(ac)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                assetClass === ac
                  ? 'bg-background text-foreground shadow'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {ac === 'all' ? 'All' : assetClassLabel(ac)}
            </button>
          ))}
        </div>
      </div>
      <ReturnSummaryCard geography={geography} assetClass={assetClass} />
      <ReturnBars geography={geography} assetClass={assetClass} />
      <TrendChart history={history.data} />
      <XirrCards xirr={xirr.data} />
    </div>
  )
}