/** Overview screen — header cards + value-over-time chart.
 *  Allocation donuts live in their own Allocation tab (AllocationScreen).
 *  Renders purely from the contract JSONs (zero network beyond the static
 *  files); stale badges + alert chips live in the StatusBar above. */

import { OverviewCards } from '@/components/overview/OverviewCards'
import { TrendChart } from '@/components/overview/TrendChart'
import { ErrorState, LoadingState } from '@/components/layout/states'
import { useHistory, useLatest, useXirr } from '@/lib/data'

export function OverviewScreen() {
  const latest = useLatest()
  const history = useHistory()
  const xirr = useXirr()

  if (latest.isLoading || history.isLoading || xirr.isLoading) {
    return <LoadingState label="Loading overview…" />
  }

  if (latest.isError || history.isError || xirr.isError) {
    const firstError =
      latest.error ?? history.error ?? xirr.error
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
      <OverviewCards latest={latest.data} xirr={xirr.data} />
      <TrendChart history={history.data} />
      {/* Allocation donuts moved to their own Allocation tab (AllocationScreen).
          Alerts live on the Alerts tab. */}
    </div>
  )
}