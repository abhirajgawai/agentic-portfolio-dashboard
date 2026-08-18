/** US view — moomoo holdings, displayed in SGD (the account's display
 *  currency) via the contract's valueDisplay field. The pipeline converts
 *  USD -> SGD with same-run FX, so this view never touches a rate itself.
 *  Includes asset class filter (ETF / Equity). */

import { useMemo, useState } from 'react'

import { HoldingsTable } from '@/components/holdings/HoldingsTable'
import { Badge } from '@/components/ui/badge'
import { ErrorState, LoadingState } from '@/components/layout/states'
import { formatSgd, MASK_TEXT, platformLabel, assetClassLabel } from '@/lib/format'
import { useLatest } from '@/lib/data'
import { usePrivacy } from '@/lib/privacy'

export function USView() {
  const latest = useLatest()
  const { masked } = usePrivacy()
  const [assetClass, setAssetClass] = useState<string>('all')

  const usHoldings = useMemo(
    () =>
      (latest.data?.holdings ?? []).filter(
        (h) => h.geography === 'US' && h.displayCurrency === 'SGD',
      ),
    [latest.data],
  )

  // Unique asset classes present
  const availableAssetClasses = useMemo(() => {
    const classes = new Set(usHoldings.map((h) => h.assetClass).filter((c): c is string => c !== null))
    return ['all', ...Array.from(classes).sort()]
  }, [usHoldings])

  const filtered = useMemo(
    () =>
      assetClass === 'all' ? usHoldings : usHoldings.filter((h) => h.assetClass === assetClass),
    [usHoldings, assetClass],
  )

  if (latest.isLoading) return <LoadingState label="Loading US holdings…" />
  if (latest.isError) {
    return (
      <ErrorState
        message={latest.error instanceof Error ? latest.error.message : String(latest.error)}
        onRetry={() => void latest.refetch()}
      />
    )
  }

  const totalSgd = filtered.reduce((sum, h) => sum + h.valueDisplay, 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-normal">
          {platformLabel('moomoo')} leg
        </Badge>
        {/* Asset Class filter */}
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
        <Badge variant="outline" className="ml-auto font-normal tabular-nums">
          {filtered.length} holdings · {masked ? MASK_TEXT : formatSgd(totalSgd)}
        </Badge>
      </div>
      <HoldingsTable holdings={filtered} displayCurrency="SGD" platformVisible={false} />
    </div>
  )
}