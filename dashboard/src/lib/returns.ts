/**
 * Derived portfolio math for the dashboard header cards.
 *
 * The contract carries per-holding `returnPct` (null = no cost basis, the M3
 * CAS value-only rows) but NOT raw cost, so the portfolio simple return is
 * derived the same way M5's `simple_return_summary` does it:
 *
 *   cost(h) = valueBase(h) / (1 + returnPct(h)/100)     for cost-bearing rows
 *   simpleReturnPct = (ΣvalueBase − Σcost) / Σcost × 100
 *
 * This is exact (returnPct is itself (value−cost)/cost×100) and honest about
 * coverage: holdings without cost basis are excluded and counted.
 */

import type { Holding } from '@/types/contract'

export type SimpleReturn = {
  /** Portfolio return % over cost-bearing holdings — null when none exist. */
  pct: number | null
  withCost: number
  noCost: number
}

export function simpleReturn(holdings: readonly Holding[]): SimpleReturn {
  let valueSum = 0
  let costSum = 0
  let withCost = 0
  for (const h of holdings) {
    if (h.returnPct === null) continue
    const cost = h.valueBase / (1 + h.returnPct / 100)
    valueSum += h.valueBase
    costSum += cost
    withCost += 1
  }
  const pct = costSum > 0 ? ((valueSum - costSum) / costSum) * 100 : null
  return { pct, withCost, noCost: holdings.length - withCost }
}

/** Mean day-change % across holdings, weighted by display value (0 when none). */
export function weightedDayChangePct(holdings: readonly Holding[]): number | null {
  let weight = 0
  let sum = 0
  for (const h of holdings) {
    if (h.dayChangePct === null) continue
    weight += h.valueDisplay
    sum += h.valueDisplay * h.dayChangePct
  }
  return weight > 0 ? sum / weight : null
}