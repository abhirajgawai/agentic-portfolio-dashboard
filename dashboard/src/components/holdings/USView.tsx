/** US view — moomoo holdings, displayed in SGD (the account's display
 *  currency) via the contract's valueDisplay field. The pipeline converts
 *  USD -> SGD with same-run FX, so this view never touches a rate itself. */

import { useMemo } from 'react'

import { HoldingsTable } from '@/components/holdings/HoldingsTable'
import { Badge } from '@/components/ui/badge'
import { ErrorState, LoadingState } from '@/components/layout/states'
import { formatSgd, platformLabel } from '@/lib/format'
import { useLatest } from '@/lib/data'

export function USView() {
  const latest = useLatest()

  const usHoldings = useMemo(
    () =>
      (latest.data?.holdings ?? []).filter(
        (h) => h.geography === 'US' && h.displayCurrency === 'SGD',
      ),
    [latest.data],
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

  const totalSgd = usHoldings.reduce((sum, h) => sum + h.valueDisplay, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="font-normal">
          {platformLabel('moomoo')} leg
        </Badge>
        <Badge variant="outline" className="ml-auto font-normal tabular-nums">
          {usHoldings.length} holdings · {formatSgd(totalSgd)}
        </Badge>
      </div>
      <HoldingsTable holdings={usHoldings} displayCurrency="SGD" platformVisible={false} />
    </div>
  )
}