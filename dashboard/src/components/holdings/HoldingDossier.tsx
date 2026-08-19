/**
 * src/components/holdings/HoldingDossier.tsx — Center-pane detail for one
 * holding, opened from a Universe row / journal selection. Shows identity,
 * position facts, a platform-trend sparkline (honest: the contract has no
 * per-holding history — this is the PLATFORM series, labeled as such), and
 * per-holding return/PNL.
 *
 * Dossier state lives in useWorkspace(): `setTransientDossier({ ticker, ... })`
 * opens it, `setTransientDossier({ ticker: null })` closes it (there is no
 * `closeDossier`). Honest empty states throughout — a missing holding renders
 * "not found", never a crash.
 */

import { useMemo } from 'react'
import { ArrowLeft, TrendingUp, Wallet } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/layout/states'
import { EChart } from '@/components/charts/EChart'
import { useSparklineOption } from '@/lib/sparkline'
import { useWorkspace } from '@/lib/workspaces'
import { formatInrCompact, formatPct, formatPrice, formatQty, MASK_TEXT, platformLabel, assetClassLabel } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { useLatest, useHistory } from '@/lib/data'
import { cn } from '@/lib/utils'
import type { Holding } from '@/types/contract'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{children}</span>
    </div>
  )
}

export function HoldingDossier() {
  const { transientDossier, setTransientDossier } = useWorkspace()
  const latest = useLatest()
  const history = useHistory()
  const { masked } = usePrivacy()

  const ticker = transientDossier?.ticker ?? null
  const holding: Holding | undefined = useMemo(
    () => (ticker ? (latest.data?.holdings ?? []).find((h) => h.ticker === ticker) : undefined),
    [latest.data, ticker],
  )

  const sparkline = useSparklineOption(holding?.platform ?? '', history.data?.byPlatform ?? {})

  const loading = latest.isLoading || history.isLoading
  const notFound = !loading && ticker !== null && !holding

  const close = () => setTransientDossier({ ticker: null, previousWorkspace: null })

  // No dossier open — nothing to render (parent shows the workspace instead).
  if (!ticker) return null

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Breadcrumb back */}
      <button
        type="button"
        onClick={close}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1 py-0.5"
      >
        <ArrowLeft className="size-3.5" /> Back to {transientDossier?.previousWorkspace ?? 'overview'}
      </button>

      {loading && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      )}

      {notFound && (
        <EmptyState
          title="Holding not found"
          description={`“${ticker}” is not in the latest snapshot. It may have been sold or the data refreshed.`}
        />
      )}

      {!loading && !notFound && holding && (
        <>
          {/* Header */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-xl">{holding.ticker}</CardTitle>
                    {holding.platform && <Badge variant="secondary">{platformLabel(holding.platform)}</Badge>}
                    {holding.geography && <Badge variant="outline">{holding.geography}</Badge>}
                    {holding.assetClass && <Badge variant="outline">{assetClassLabel(holding.assetClass)}</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{holding.name ?? '—'}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-semibold tabular-nums">
                    {masked ? MASK_TEXT : formatInrCompact(holding.valueBase)}
                  </div>
                  <div
                    className={cn(
                      'text-xs font-medium tabular-nums',
                      (holding.dayChangePct ?? 0) >= 0 ? 'text-gain' : 'text-loss',
                    )}
                  >
                    {holding.dayChangePct === null ? '—' : formatPct(holding.dayChangePct)} today
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              <Row label="Qty">
                {masked ? MASK_TEXT : formatQty(holding.qty)}
              </Row>
              <Row label="Avg price">
                {holding.avgPrice === null ? '—' : masked ? MASK_TEXT : formatPrice(holding.avgPrice)}
              </Row>
              <Row label="Last price">
                {masked ? MASK_TEXT : formatPrice(holding.ltp)}
              </Row>
              <Row label="Sector">{holding.sector ? assetClassLabel(holding.sector) : '—'}</Row>
              <Row label="Currency">{holding.displayCurrency ?? holding.currency}</Row>
              <Row label="Return">
                {holding.returnPct === null ? (
                  <span className="text-muted-foreground">no cost basis</span>
                ) : (
                  <span className={holding.returnPct >= 0 ? 'text-gain' : 'text-loss'}>{formatPct(holding.returnPct)}</span>
                )}
              </Row>
              <Row label="Day P&L">
                {holding.dayPnl === null ? '—' : masked ? MASK_TEXT : formatInrCompact(holding.dayPnl)}
              </Row>
            </CardContent>
          </Card>

          {/* Platform trend (honest label — not per-holding) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <TrendingUp className="size-3.5" />
                Platform trend
                <Badge variant="outline" className="font-normal text-[10px]">
                  {platformLabel(holding.platform)} · base INR
                </Badge>
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                The contract has no per-holding history — this is the {platformLabel(holding.platform)} platform series.
              </p>
            </CardHeader>
            <CardContent>
              {sparkline ? (
                <EChart option={sparkline} height={120} />
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
                  <Wallet className="size-3.5" />
                  No platform history yet — snapshots accumulate from the first pipeline run.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Position detail */}
          <Card>
            <CardContent className="p-4">
              <Separator className="mb-2" />
              <p className="text-[11px] text-muted-foreground">
                as of {holding.asOf ?? '—'} · ISIN {holding.isin ?? '—'}
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
