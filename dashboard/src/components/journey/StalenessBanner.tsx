/**
 * Staleness chip — surfaces on the Journey screen only when at least one
 * data source hasn't been refreshed recently. Added because the laptop
 * (and the zerodha/moomoo daemons on it) isn't always on, so the scheduled
 * snapshot tasks were quietly failing when the machine was off during their
 * fixed IST trigger times; this replaces "wait for the next scheduled run
 * and hope it succeeds" with an explicit in-app nudge whenever you're
 * actually looking at the dashboard.
 *
 * Ledger Gold redesign (docs/superpowers/specs/2026-09-12-ledger-gold-redesign-design.md
 * §3.1): condensed from a full-detail warning box (per-source list + hints)
 * to a single compact pill that deep-links to the Alerts workspace via
 * `onNavigateToAlerts` — staleness is an attention/alert concept, not a
 * trend one, so the per-source detail now lives on Alerts (§3.4) instead of
 * dominating the Journey page above the chart. The bucket computation itself
 * moved to `journey/staleness.ts` (unchanged logic) so `AlertsScreen.tsx` can
 * render the same buckets in full; only this component's own rendering
 * collapsed to a chip.
 */

import { AlertTriangle, ArrowRight } from 'lucide-react'

import { buildStalenessBuckets } from '@/components/journey/staleness'
import { cn } from '@/lib/utils'
import type { Latest } from '@/types/contract'

export function StalenessBanner({
  latest,
  onNavigateToAlerts,
}: {
  latest: Latest
  /** Deep-links to the Alerts workspace, which now owns the full per-source
   *  detail this chip used to render inline (§3.1/§3.4 of the design brief). */
  onNavigateToAlerts?: () => void
}) {
  const now = new Date()
  const buckets = buildStalenessBuckets(latest, now)
  const stale = buckets.filter((b) => b.stale)

  if (stale.length === 0) return null

  const label = stale.length === 1 ? '1 source needs attention' : `${stale.length} sources need attention`

  return (
    <button
      type="button"
      onClick={onNavigateToAlerts}
      disabled={!onNavigateToAlerts}
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning transition-colors',
        onNavigateToAlerts && 'cursor-pointer hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <AlertTriangle className="size-3.5 shrink-0" />
      {label}
      {onNavigateToAlerts && <ArrowRight className="size-3 shrink-0" />}
    </button>
  )
}
