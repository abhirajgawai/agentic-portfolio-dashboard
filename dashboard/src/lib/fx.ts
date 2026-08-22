/**
 * src/lib/fx.ts — FX conversion for the day-P&L view.
 *
 * Pure, deterministic, NODE-SAFE: imports only contract types (no React, no
 * data-fetching), so the derivation can run under tsx in the check scripts
 * (scripts/check-daypnl.ts) as well as in the browser bundle. The other
 * segments.ts helpers need React hooks/data queries and therefore cannot be
 * imported by a node script — splitting the FX helpers out keeps the whole
 * derivation graph importable everywhere.
 *
 * fxToInr is THE single source of truth for the day-P&L conversion: both
 * dayPnlLiveInr and the Day P&L breakdown's per-platform rows call it, so
 * their totals reconcile to the same number by construction (verified live:
 * Σ platforms == latest.totals.dayPnl to rounding).
 */

import type { Holding, Latest } from '../types/contract'

/** FX factor from a holding's settlement currency to the base (INR): 1 for
 *  INR, the export's same-run USDINR for USD, SGDINR for SGD; null for any
 *  other currency (unknown currencies are skipped — never fabricated). */
export function fxToInr(currency: string, latest: Latest): number | null {
  if (currency === 'INR') return 1
  if (currency === 'USD') return latest.fx.USDINR
  if (currency === 'SGD') return latest.fx.SGDINR
  return null
}

/** LIVE day P&L in the base currency: Σ h.dayPnl × fxToInr(h.currency) over
 *  members with a day P&L. fx comes from the export's own same-run rates
 *  (1 for INR, USDINR for USD, SGDINR for SGD); unknown currencies are
 *  skipped — never fabricated. null when NO member carries a day P&L
 *  (Groww-CAS: all rows have dayPnl null, so the segment honestly shows "—").
 *  Re-exported from segments.ts so the segment/breakdown consumers keep
 *  importing it from @/lib/segments as before. */
export function dayPnlLiveInr(latest: Latest, holdings: readonly Holding[]): number | null {
  let sum = 0
  let any = false
  for (const h of holdings) {
    if (h.dayPnl === null) continue
    const fx = fxToInr(h.currency, latest)
    if (fx === null) continue
    sum += h.dayPnl * fx
    any = true
  }
  return any ? sum : null
}