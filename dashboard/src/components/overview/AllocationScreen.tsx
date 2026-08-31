/** Allocation workspace — four donut charts + portfolio trend chart +
 *  Top Gainers / Top Losers from today's performance. */

import { AllocationDonuts } from '@/components/overview/AllocationDonuts'
import { TrendChart } from '@/components/overview/TrendChart'
import { ErrorState, LoadingState } from '@/components/layout/states'
import { useLatest, useHistory, usePerformance } from '@/lib/data'
import { formatInrCompact, formatPct } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import type { PerformanceMover } from '@/types/contract'

function TopMoversSection({ perf }: { perf: ReturnType<typeof usePerformance>['data'] }) {
  const { masked } = usePrivacy()

  const daily = perf?.daily
  if (!daily || daily.length === 0) return null

  const today = daily[daily.length - 1]
  const movers: PerformanceMover[] = today?.topMovers ?? []

  if (movers.length === 0) return null

  // Split into gainers and losers
  const gainers = movers.filter((m) => m.dayPnlBase > 0)
  const losers = movers.filter((m) => m.dayPnlBase < 0)

  if (gainers.length === 0 && losers.length === 0) return null

  const renderMovers = (movers: PerformanceMover[], isGain: boolean) => (
    <div className="space-y-1.5">
      {movers.slice(0, 5).map((m) => {
        // dayPnlBase is in INR (base currency). For display, we show the INR amount.
        // For US holdings (moomoo), the display currency is SGD, but the base is INR.
        // We show the INR absolute value since that's what dayPnlBase is.
        const dayPnlAbs = m.dayPnlBase
        const dayPnlDisplay = masked ? '****' : formatInrCompact(Math.abs(dayPnlAbs))
        const dayPnlPct = m.valueBase !== 0 ? ((dayPnlAbs / m.valueBase) * 100) : 0

        return (
          <div
            key={`${m.platform}:${m.ticker}`}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
              isGain ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'
            }`}
          >
            <span className="font-medium truncate min-w-0">{m.ticker}</span>
            <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
              {m.name ? `${m.name} · ` : ''}{m.platform}
            </span>
            <span className="font-mono tabular-nums whitespace-nowrap">
              {isGain ? '+' : ''}{formatPct(dayPnlPct)}
            </span>
            <span className="font-mono tabular-nums whitespace-nowrap text-xs">
              ({isGain ? '+' : ''}{dayPnlDisplay})
            </span>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {gainers.length > 0 && (
        <div className="rounded-lg border border-gain/30 bg-gain/5 p-3">
          <h3 className="text-xs font-semibold text-gain uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 15l-6-6-6 6" />
            </svg>
            Top Gainers ({gainers.length})
          </h3>
          {renderMovers(gainers, true)}
        </div>
      )}
      {losers.length > 0 && (
        <div className="rounded-lg border border-loss/30 bg-loss/5 p-3">
          <h3 className="text-xs font-semibold text-loss uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
            Top Losers ({losers.length})
          </h3>
          {renderMovers(losers, false)}
        </div>
      )}
    </div>
  )
}

export function AllocationScreen() {
  const latest = useLatest()
  const history = useHistory()
  const perf = usePerformance()

  if (latest.isLoading || history.isLoading || perf.isLoading) {
    return <LoadingState label="Loading allocation…" />
  }

  if (latest.isError || history.isError || perf.isError) {
    const err = latest.error ?? history.error ?? perf.error
    return (
      <ErrorState
        message={err instanceof Error ? err.message : String(err)}
        onRetry={() => { void latest.refetch(); void history.refetch(); void perf.refetch() }}
      />
    )
  }

  if (!latest.data || !history.data) return null

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Allocation</h1>
        <p className="text-sm text-muted-foreground">
          Portfolio composition by asset class and platform, plus today's
          biggest movers.
        </p>
      </div>
      <AllocationDonuts allocation={latest.data.allocation} />
      <TrendChart history={history.data} />
      <TopMoversSection perf={perf.data} />
    </div>
  )
}