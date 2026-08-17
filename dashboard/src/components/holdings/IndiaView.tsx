/** India view — all INR-leg holdings (zerodha / groww / sharekhan) with a
 *  platform filter. Value shown in INR (valueBase == valueDisplay on this leg). */

import { useMemo, useState } from 'react'

import { HoldingsTable } from '@/components/holdings/HoldingsTable'
import { Badge } from '@/components/ui/badge'
import { ErrorState, LoadingState } from '@/components/layout/states'
import { formatInrCompact, platformLabel } from '@/lib/format'
import { useLatest } from '@/lib/data'
import { cn } from '@/lib/utils'

const PLATFORMS = ['all', 'zerodha', 'groww', 'sharekhan'] as const
type PlatformFilter = (typeof PLATFORMS)[number]

export function IndiaView() {
  const latest = useLatest()
  const [platform, setPlatform] = useState<PlatformFilter>('all')

  const indiaHoldings = useMemo(
    () =>
      (latest.data?.holdings ?? []).filter(
        (h) => h.geography === 'IN' && h.displayCurrency === 'INR',
      ),
    [latest.data],
  )

  const filtered = useMemo(
    () =>
      platform === 'all' ? indiaHoldings : indiaHoldings.filter((h) => h.platform === platform),
    [indiaHoldings, platform],
  )

  if (latest.isLoading) return <LoadingState label="Loading India holdings…" />
  if (latest.isError) {
    return (
      <ErrorState
        message={latest.error instanceof Error ? latest.error.message : String(latest.error)}
        onRetry={() => void latest.refetch()}
      />
    )
  }

  const total = indiaHoldings.reduce((sum, h) => sum + h.valueBase, 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                platform === p
                  ? 'bg-background text-foreground shadow'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p === 'all' ? 'All' : platformLabel(p)}
            </button>
          ))}
        </div>
        <Badge variant="outline" className="ml-auto font-normal tabular-nums">
          {indiaHoldings.length} holdings · {formatInrCompact(total)}
        </Badge>
      </div>
      <HoldingsTable holdings={filtered} displayCurrency="INR" platformVisible />
    </div>
  )
}