/**
 * src/lib/dayPnl.ts — Day P&L breakdown for the Overview card.
 *
 * Pure, deterministic CLIENT-SIDE derivation from the immutable JSON contract
 * (latest.json only). The "Day P&L" card headline shows latest.totals.dayPnl —
 * a LIVE broker view: per-holding dayPnl in each holding's settlement currency
 * (zerodha INR, moomoo USD) converted to the base (INR) with the export's
 * same-run FX. This module derives the per-platform + per-holding breakdown
 * behind that number.
 *
 * The conversion formula lives in EXACTLY one place: fxToInr() in lib/fx.ts
 * (also used by dayPnlLiveInr in lib/segments.ts), so Σ platform basePnl ==
 * the card number to rounding BY CONSTRUCTION — a verified live property
 * (08-20 export: 8801.38 + 111.2006 × 95.74875526618153 = 19448.6990 vs
 * totals.dayPnl = 19448.70).
 *
 * Honesty rules (determinism boundary):
 *   - Only holdings with dayPnl !== null contribute; CAS rows (groww,
 *     sharekhan), real estate and even a CAS-imported Zerodha MF carry
 *     dayPnl null — no live day P&L, never fabricated.
 *   - Unknown currencies are skipped exactly like dayPnlLiveInr.
 *   - asOf comes from the data (latest.asOf), never the wall clock; the same
 *     data file always derives the same breakdown.
 *   - Full precision is kept in the lib; rounding to 2dp happens only in the
 *     display components, so the reconciliation check (|total −
 *     latest.totals.dayPnl| ≤ 0.01) is exact.
 */

import type { Latest } from '../types/contract'
import { fxToInr } from './fx'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** One day-P&L-bearing holding, converted with its settlement-currency FX. */
export interface DayPnlHoldingRow {
  ticker: string
  name: string | null
  /** Settlement currency (INR for zerodha, USD for moomoo). */
  currency: string
  /** Broker-reported day P&L in the settlement currency (full precision). */
  nativePnl: number
  /** fxToInr(currency) — the export's same-run rate (1 for INR). */
  fxRate: number
  /** nativePnl × fxRate in the base currency (full precision). */
  basePnl: number
}

/** One (platform, settlement-currency) group with ≥1 day-P&L-bearing holding.
 *  A platform carrying day P&L in TWO currencies yields TWO rows (compound
 *  grouping key `${platform}__${currency}`) — natives are never summed across
 *  currencies under one rate label. */
export interface DayPnlPlatformRow {
  /** Compound grouping key `${platform}__${currency}` — unique per row. */
  id: string
  /** Platform name (for display; real_estate → "Real estate" in the UI). */
  platform: string
  /** Settlement currency of this row's day P&L. */
  currency: string
  /** Σ h.dayPnl over the row's day-P&L-bearing holdings (full precision). */
  nativePnl: number
  /** fxToInr(currency) — 1 for INR. */
  fxRate: number
  /** Σ h.dayPnl × fxRate (full precision). */
  basePnl: number
  holdings: DayPnlHoldingRow[]
}

export interface DayPnlBreakdown {
  /** Σ platform basePnl — reconciles to latest.totals.dayPnl within 0.01. */
  total: number
  /** The export's reference instant (latest.asOf). */
  asOf: string | null
  /** (platform, currency) groups with ≥1 day-P&L-bearing holding, sorted by
   *  (platform name, currency). */
  platforms: DayPnlPlatformRow[]
  /** Platforms present in the holdings but with NO day P&L at all
   *  (e.g. groww/sharekhan/real_estate), sorted by name. */
  noDayPnlPlatforms: string[]
  /** Holdings that did NOT contribute: dayPnl null (CAS rows, real estate,
   *  the CAS-imported Zerodha MF) plus day-P&L-bearing holdings in an
   *  unknown currency (skipped like dayPnlLiveInr). */
  excludedCount: number
}

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Group latest.holdings by platform and derive the day-P&L breakdown.
 * Returns null when ZERO holdings carry a day P&L (the Groww-CAS-only case —
 * the card already shows "no day P&L data" then). Deterministic: same data
 * file in, same breakdown out.
 */
export function dayPnlBreakdown(latest: Latest): DayPnlBreakdown | null {
  let total = 0
  let any = false
  const excluded: string[] = []
  const platforms = new Map<string, DayPnlPlatformRow>()

  for (const h of latest.holdings) {
    if (h.dayPnl === null) {
      excluded.push(h.ticker)
      continue
    }
    const fxRate = fxToInr(h.currency, latest)
    if (fxRate === null) {
      excluded.push(h.ticker)
      continue
    }
    // Compound grouping key: a platform carrying day P&L in two currencies
    // yields one row PER currency — natives are never summed across
    // currencies under one rate label (review MINOR 2; latent, not live).
    const key = `${h.platform}__${h.currency}`
    let row = platforms.get(key)
    if (!row) {
      row = {
        id: key,
        platform: h.platform,
        currency: h.currency,
        nativePnl: 0,
        fxRate,
        basePnl: 0,
        holdings: [],
      }
      platforms.set(key, row)
    }
    row.nativePnl += h.dayPnl
    row.basePnl += h.dayPnl * fxRate
    row.holdings.push({
      ticker: h.ticker,
      name: h.name,
      currency: h.currency,
      nativePnl: h.dayPnl,
      fxRate,
      basePnl: h.dayPnl * fxRate,
    })
    total += h.dayPnl * fxRate
    any = true
  }

  if (!any) return null

  const rows = [...platforms.values()]
  const rowPlatforms = new Set(rows.map((r) => r.platform))
  const present = new Set(latest.holdings.map((h) => h.platform))
  const noDayPnlPlatforms = [...present]
    .filter((p) => !rowPlatforms.has(p))
    .sort((a, b) => a.localeCompare(b))

  return {
    total,
    asOf: latest.asOf,
    platforms: rows.sort(
      (a, b) => a.platform.localeCompare(b.platform) || a.currency.localeCompare(b.currency),
    ),
    noDayPnlPlatforms,
    excludedCount: excluded.length,
  }
}