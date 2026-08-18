/** India view — all INR-leg holdings (zerodha / groww / sharekhan) with a
 *  two-level filter: Platform (Zerodha/Groww/Sharekhan) → Asset Class (ETF/MF/Stocks).
 *  Value shown in INR (valueBase == valueDisplay on this leg). */

import { useMemo, useState } from 'react'

import { HoldingsTable } from '@/components/holdings/HoldingsTable'
import { Badge } from '@/components/ui/badge'
import { ErrorState, LoadingState } from '@/components/layout/states'
import { formatInrCompact, MASK_TEXT, platformLabel, assetClassLabel } from '@/lib/format'
import { useLatest } from '@/lib/data'
import { usePrivacy } from '@/lib/privacy'
import { cn } from '@/lib/utils'

const PLATFORMS = ['all', 'zerodha', 'groww', 'sharekhan'] as const
type PlatformFilter = (typeof PLATFORMS)[number]

const ASSET_CLASSES = ['all', 'etf', 'mutual_fund', 'stock'] as const
type AssetClassFilter = (typeof ASSET_CLASSES)[number] | string

export function IndiaView() {
  const latest = useLatest()
  const { masked } = usePrivacy()
  const [platform, setPlatform] = useState<PlatformFilter>('all')
  const [assetClass, setAssetClass] = useState<AssetClassFilter>('all')

  const indiaHoldings = useMemo(
    () =>
      (latest.data?.holdings ?? []).filter(
        (h) => h.geography === 'IN' && h.displayCurrency === 'INR',
      ),
    [latest.data],
  )

  const filtered = useMemo(
    () => {
      let result = indiaHoldings
      if (platform !== 'all') {
        result = result.filter((h) => h.platform === platform)
      }
      if (assetClass !== 'all') {
        result = result.filter((h) => h.assetClass === assetClass)
      }
      return result
    },
    [indiaHoldings, platform, assetClass],
  )

  // Unique asset classes present in current platform selection (for dynamic filter)
  const availableAssetClasses = useMemo(() => {
    const base = platform === 'all' ? indiaHoldings : indiaHoldings.filter((h) => h.platform === platform)
    const classes = new Set(base.map((h) => h.assetClass).filter((c): c is string => c !== null))
    return ['all', ...Array.from(classes).sort()] as const
  }, [indiaHoldings, platform])

  if (latest.isLoading) return <LoadingState label="Loading India holdings…" />
  if (latest.isError) {
    return (
      <ErrorState
        message={latest.error instanceof Error ? latest.error.message : String(latest.error)}
        onRetry={() => void latest.refetch()}
      />
    )
  }

  const total = filtered.reduce((sum, h) => sum + h.valueBase, 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPlatform(p)
                // Reset asset class filter when platform changes
                if (p !== platform) setAssetClass('all')
              }}
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

        {/* Asset Class filter — only shows classes relevant to selected platform */}
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1 ml-2">
          {availableAssetClasses.map((ac) => (
            <button
              key={ac}
              type="button"
              onClick={() => setAssetClass(ac)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                assetClass === ac
                  ? 'bg-background text-foreground shadow'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {ac === 'all' ? 'All' : assetClassLabel(ac)}
            </button>
          ))}
        </div>

        <Badge variant="outline" className="ml-auto font-normal tabular-nums">
          {filtered.length} holdings · {masked ? MASK_TEXT : formatInrCompact(total)}
        </Badge>
      </div>
      <HoldingsTable holdings={filtered} displayCurrency="INR" platformVisible />
    </div>
  )
}