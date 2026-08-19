/**
 * Today panel — the day in words: day P&L headline ("Down ₹19.5k today"), an
 * account-currency leg breakdown (latest.json dayPnlByAccountCurrency — the
 * contract keys by CURRENCY, not platform), the top mover (largest |day
 * change %| — percentages survive the privacy mask by design) and today's
 * alert count.
 *
 * Money is privacy-masked; the headline ticks with a delta counter on refresh
 * (motion-spec §2, via ./animation) unless the user prefers reduced motion,
 * and the FINAL value is announced once via an sr-only aria-live region (no
 * mid-tick chatter, a11y-spec §5).
 */

import { BellRing, MoveUpRight } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatAsOf, formatInrCompact, formatPct, formatSgd, MASK_TEXT } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { cn } from '@/lib/utils'
import type { Alerts, Latest } from '@/types/contract'
import { useAnimatedNumber } from './animation'

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

/** Largest |day change %| among holdings with a live day move. */
function topMover(latest: Latest): { ticker: string; pct: number } | null {
  let best: { ticker: string; pct: number } | null = null
  for (const holding of latest.holdings) {
    if (holding.dayChangePct === null) continue
    const magnitude = Math.abs(holding.dayChangePct)
    if (!best || magnitude > Math.abs(best.pct)) {
      best = { ticker: holding.ticker, pct: holding.dayChangePct }
    }
  }
  return best
}

/** Account-currency -> human leg label (INR ≈ India leg, SGD ≈ US/moomoo). */
const LEG_LABELS: Record<string, string> = { INR: 'India (INR)', SGD: 'US (SGD)' }
const legLabel = (ccy: string) => LEG_LABELS[ccy] ?? ccy

/** Signed display value in the leg's own currency. */
function formatLegValue(ccy: string, value: number): string {
  const sign = value > 0 ? '+' : ''
  if (ccy === 'SGD') return `${sign}${formatSgd(value)}`
  return `${sign}${formatInrCompact(value)}`
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function TodayPanel({
  latest,
  alerts,
}: {
  latest: Latest
  alerts: Alerts | undefined
}) {
  const { masked } = usePrivacy()
  const delta = latest.totals.dayPnl
  const animatedDelta = useAnimatedNumber(delta)
  const settled = Math.abs(animatedDelta - delta) < 0.5
  const mover = topMover(latest)
  const alertCount = alerts?.alerts.length ?? 0
  const legs = Object.entries(latest.totals.dayPnlByAccountCurrency)

  const direction = delta > 0 ? 'Up' : delta < 0 ? 'Down' : 'Flat'

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Today</h3>
          <span className="text-[11px] text-muted-foreground">{formatAsOf(latest.asOf)}</span>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          {direction}{' '}
          <span
            className={cn(
              'font-semibold tabular-nums',
              delta > 0 ? 'text-gain' : delta < 0 ? 'text-loss' : 'text-foreground',
            )}
          >
            {masked ? MASK_TEXT : formatInrCompact(Math.abs(animatedDelta))}
          </span>{' '}
          <span className="text-muted-foreground/70">today</span>
          <span className="sr-only" aria-live="polite">
            {settled
              ? `${direction} ${masked ? 'hidden amount' : formatInrCompact(Math.abs(delta))} today`
              : ''}
          </span>
        </p>

        {legs.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground">By leg</p>
            <ul className="mt-1 space-y-1">
              {legs.map(([ccy, value]) => (
                <li key={ccy} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{legLabel(ccy)}</span>
                  <span
                    className={cn(
                      'font-medium tabular-nums',
                      value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : 'text-muted-foreground',
                    )}
                  >
                    {masked ? MASK_TEXT : formatLegValue(ccy, value)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <MoveUpRight className="size-3" /> Top mover
          </span>
          {mover ? (
            <span className="text-xs font-medium">
              {mover.ticker}{' '}
              <span
                className={cn(
                  'tabular-nums',
                  mover.pct >= 0 ? 'text-gain' : 'text-loss',
                )}
              >
                {formatPct(mover.pct)}
              </span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">no live day data yet</span>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <BellRing className="size-3" /> Alerts today
          </span>
          <Badge variant={alertCount > 0 ? 'warning' : 'secondary'}>{alertCount}</Badge>
        </div>
      </CardContent>
    </Card>
  )
}
