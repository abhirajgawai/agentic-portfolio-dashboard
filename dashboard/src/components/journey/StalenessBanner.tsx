/**
 * Staleness banner — surfaces on the Journey screen only when at least one
 * data source hasn't been refreshed recently. Added because the laptop
 * (and the zerodha/moomoo daemons on it) isn't always on, so the scheduled
 * snapshot tasks were quietly failing when the machine was off during their
 * fixed IST trigger times; this replaces "wait for the next scheduled run
 * and hope it succeeds" with an explicit in-app nudge whenever you're
 * actually looking at the dashboard.
 *
 * Five buckets, computed entirely from latest.json (no extra fetch):
 *   - zerodha / moomoo: latest.platforms[x].{asOf,stale} — same freshness
 *     signal export_json.py already computes from position.updated_at
 *     (2-day threshold — see PLATFORM_STALE_DAYS in scripts/export_json.py).
 *   - groww MFs: MAX(asOf) over groww holdings EXCLUDING the manual lump-sum
 *     row (ticker MANUAL_TOTAL) — computed here rather than reused from
 *     latest.platforms.groww because that field aggregates MF + manual
 *     equities together, so an edit to one masks staleness in the other.
 *   - groww / sharekhan equities: the platform's MANUAL_TOTAL holding's own
 *     asOf (ManualEquitiesScreen — hand-entered, no automated refresh).
 * All three non-live buckets (groww MFs, groww equities, sharekhan) are
 * stale whenever they weren't touched TODAY (IST calendar date) — the user
 * pulls fresh CAS data + re-enters manual totals every login, so "today"
 * is the expected cadence, not export_json.py's more lenient 35-day
 * CAS-platform threshold (that one's calibrated for infrequent logins).
 */

import { AlertTriangle } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { formatAsOf } from '@/lib/format'
import type { Latest } from '@/types/contract'

interface Bucket {
  key: string
  label: string
  asOf: string | null
  stale: boolean
  hint: string
}

/** IST calendar date, "YYYY-MM-DD" (site convention — formatAsOf is always IST). */
function istDateString(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/** Stale unless asOf falls on today's IST calendar date. */
function isStaleNotToday(asOf: string | null, now: Date): boolean {
  if (!asOf) return true
  const d = new Date(asOf)
  if (Number.isNaN(d.getTime())) return true
  return istDateString(d) !== istDateString(now)
}

function maxAsOf(values: (string | null | undefined)[]): string | null {
  let best: string | null = null
  for (const v of values) {
    if (!v) continue
    if (!best || v > best) best = v
  }
  return best
}

function buildBuckets(latest: Latest, now: Date): Bucket[] {
  const growwMfAsOf = maxAsOf(
    latest.holdings.filter((h) => h.platform === 'groww' && h.ticker !== 'MANUAL_TOTAL').map((h) => h.asOf),
  )
  const growwEquityAsOf =
    latest.holdings.find((h) => h.platform === 'groww' && h.ticker === 'MANUAL_TOTAL')?.asOf ?? null
  const sharekhanAsOf = maxAsOf(latest.holdings.filter((h) => h.platform === 'sharekhan').map((h) => h.asOf))

  return [
    {
      key: 'zerodha',
      label: 'Zerodha',
      asOf: latest.platforms.zerodha?.asOf ?? null,
      stale: latest.platforms.zerodha?.stale ?? true,
      hint: 'take a snapshot below',
    },
    {
      key: 'moomoo',
      label: 'Moomoo',
      asOf: latest.platforms.moomoo?.asOf ?? null,
      stale: latest.platforms.moomoo?.stale ?? true,
      hint: 'take a snapshot below',
    },
    {
      key: 'groww-mf',
      label: "Groww MFs",
      asOf: growwMfAsOf,
      stale: isStaleNotToday(growwMfAsOf, now),
      hint: 'Request Fresh CAS / Run Full Auto-Import on the Groww/Sharekhan Data tab',
    },
    {
      key: 'groww-equity',
      label: 'Groww equities',
      asOf: growwEquityAsOf,
      stale: isStaleNotToday(growwEquityAsOf, now),
      hint: 'update the manual total on the Groww/Sharekhan Data tab',
    },
    {
      key: 'sharekhan',
      label: 'Sharekhan',
      asOf: sharekhanAsOf,
      stale: isStaleNotToday(sharekhanAsOf, now),
      hint: 'update the manual total on the Groww/Sharekhan Data tab',
    },
  ]
}

export function StalenessBanner({ latest }: { latest: Latest }) {
  const now = new Date()
  const buckets = buildBuckets(latest, now)
  const stale = buckets.filter((b) => b.stale)

  if (stale.length === 0) return null

  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-warning">
          <AlertTriangle className="size-3.5 shrink-0" />
          {stale.length === 1 ? '1 data source needs a refresh' : `${stale.length} data sources need a refresh`}
        </div>
        <ul className="space-y-1">
          {stale.map((b) => (
            <li key={b.key} className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{b.label}</span>
              <span>
                — last updated {b.asOf ? formatAsOf(b.asOf) : 'never'}, {b.hint}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
