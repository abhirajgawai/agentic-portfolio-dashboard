/**
 * Pure per-source staleness derivation — shared by `StalenessBanner.tsx`
 * (Journey's compact chip) and `AlertsScreen.tsx` (the Ledger Gold redesign's
 * "Data freshness" detail list, §3.4 of
 * docs/superpowers/specs/2026-09-12-ledger-gold-redesign-design.md). Extracted
 * out of StalenessBanner so both surfaces compute the exact same five buckets
 * from the exact same rules instead of duplicating the logic.
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

import type { Latest } from '@/types/contract'

export interface StalenessBucket {
  key: string
  label: string
  asOf: string | null
  stale: boolean
  hint: string
}

/** IST calendar date, "YYYY-MM-DD" (site convention — formatAsOf is always IST). */
export function istDateString(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/** Stale unless asOf falls on today's IST calendar date. */
export function isStaleNotToday(asOf: string | null, now: Date): boolean {
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

export function buildStalenessBuckets(latest: Latest, now: Date): StalenessBucket[] {
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
      hint: 'take a snapshot on Journey',
    },
    {
      key: 'moomoo',
      label: 'Moomoo',
      asOf: latest.platforms.moomoo?.asOf ?? null,
      stale: latest.platforms.moomoo?.stale ?? true,
      hint: 'take a snapshot on Journey',
    },
    {
      key: 'groww-mf',
      label: 'Groww MFs',
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
