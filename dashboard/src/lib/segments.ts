/**
 * src/lib/segments.ts — Four portfolio segments: US · India · Groww-CAS ·
 * Consolidated.
 *
 * Pure, deterministic CLIENT-SIDE derivation from the immutable JSON contract
 * (latest.json + history.json + performance.json). The "Segments" view
 * consumes SegmentSummary; nothing here talks to the bridge, the agent, or the
 * wall clock.
 *
 * Why derive instead of asking the pipeline for a 4th file? The contract is
 * immutable (M8 rule) and the pipeline's own records already partition the same
 * holdings — geography (IN/US) and platform (groww, sharekhan). The four
 * segments are two overlapping partitions of one holdings array:
 *
 *   us           = geography 'US'                              (moomoo only)
 *   india        = geography 'IN'   (zerodha + groww + sharekhan + real_estate)
 *   cas          = platform groww + sharekhan                  (the CAS import)
 *   consolidated = every holding
 *
 * Honesty rules (determinism boundary):
 *   - The staleness reference instant is latest.asOf (the export's own "now"),
 *     never the wall clock — the same data file always derives the same
 *     segments.
 *   - dayPnl comes from performance.json's attribution (the M8.6 ledger view),
 *     which can LAG latest.json's broker live day P&L (the 08-18 export even
 *     had dayPnlBase=0 while latest.json carried broker day P&L). dayPnlDate
 *     exposes the ledger date so the UI can label it honestly.
 *   - dayPnlLive is the FRESHEST view: per-holding dayPnl summed from
 *     latest.json (broker-reported, live legs only) with same-run FX. CAS rows
 *     carry dayPnl = null, so a CAS-only segment derives null — never a
 *     fabricated one-day move.
 *   - performance.json is OPTIONAL: when it is missing/errored the segments
 *     still derive valueBase/series/returns from latest+history, with ALL day
 *     P&L fields null together (dayPnl/dayPnlLive/dayPnlDate) — a coherent
 *     degraded state the cards render as "—".
 *   - simpleReturnPct excludes costless rows (returnPct === null) and is null
 *     when no cost basis exists — reused from lib/returns.ts::simpleReturn()
 *     so the M5 formula lives in exactly one place.
 */

import type {
  History,
  Holding,
  Latest,
  Performance,
  PerformanceDaily,
} from '../types/contract'
import { simpleReturn } from './returns'
import { useHistory, useLatest, usePerformance } from './data'
// The day-P&L FX helpers live in ./fx (pure + node-safe so the check scripts
// can import them); segments re-exports them so existing consumers keep
// importing from @/lib/segments unchanged.
import { dayPnlLiveInr } from './fx'
export { dayPnlLiveInr, fxToInr } from './fx'

/* ------------------------------------------------------------------ */
/* Segment definitions                                                 */
/* ------------------------------------------------------------------ */

export type SegmentId = 'us' | 'india' | 'cas' | 'consolidated'

export interface SegmentDefinition {
  id: SegmentId
  label: string
  /** True when a holding belongs to this segment. */
  matches: (h: Holding) => boolean
}

/** The four segments in canonical display order. */
export const SEGMENT_DEFINITIONS: readonly SegmentDefinition[] = [
  { id: 'us', label: 'US', matches: (h) => h.geography === 'US' },
  { id: 'india', label: 'India', matches: (h) => h.geography === 'IN' },
  {
    id: 'cas',
    label: 'Groww-CAS',
    matches: (h) => h.platform === 'groww' || h.platform === 'sharekhan',
  },
  { id: 'consolidated', label: 'Consolidated', matches: () => true },
]

/* ------------------------------------------------------------------ */
/* Staleness constants (mirror scripts/export_json.py PLATFORM_STALE_DAYS) */
/* ------------------------------------------------------------------ */

/** Live broker legs refresh daily (zerodha MCP, moomoo OpenD). */
export const LIVE_BROKER_STALE_DAYS = 2
/** CAS-import platforms refresh on the monthly statement cadence. */
export const CAS_STALE_DAYS = 35

const PLATFORM_STALE_DAYS: Record<string, number> = {
  zerodha: LIVE_BROKER_STALE_DAYS,
  moomoo: LIVE_BROKER_STALE_DAYS,
  groww: CAS_STALE_DAYS,
  sharekhan: CAS_STALE_DAYS,
}
/** export_json.py DEFAULT_STALE_DAYS — covers real_estate and any new platform. */
const DEFAULT_STALE_DAYS = LIVE_BROKER_STALE_DAYS

/** Staleness threshold for one platform (pipeline-parity). */
export function staleThresholdDays(platform: string): number {
  return PLATFORM_STALE_DAYS[platform] ?? DEFAULT_STALE_DAYS
}

const MS_PER_DAY = 86_400_000

/** Whole+partial days between two ISO timestamps; null when either is missing
 *  or unparseable. Deterministic — both inputs come from the data files. */
function daysBetweenIso(afterIso: string | null, beforeIso: string | null): number | null {
  if (!afterIso || !beforeIso) return null
  const after = new Date(afterIso)
  const before = new Date(beforeIso)
  if (Number.isNaN(after.getTime()) || Number.isNaN(before.getTime())) return null
  return (after.getTime() - before.getTime()) / MS_PER_DAY
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Cost-basis coverage, same shape as performance.json's costCoverage. */
export interface SegmentCostCoverage {
  withCost: number
  noCost: number
}

/** Base-currency value series, index-aligned with `dates`. */
export interface SegmentSeries {
  dates: readonly string[]
  values: readonly number[]
}

export interface SegmentSummary {
  id: SegmentId
  label: string
  /** Total value in the portfolio base currency (INR). */
  valueBase: number
  /** Sum of valueDisplay when every holding shares ONE display currency that
   *  DIFFERS from the portfolio base currency (US → SGD vs an INR base); null
   *  otherwise — India/CAS display in base INR (valueDisplay is redundant
   *  there), consolidated is mixed (INR + SGD). Per spec, displayValue exists
   *  for non-base display currencies only. */
  displayValue: number | null
  displayCurrency: string | null
  /** Ledger day P&L (performance attribution, base currency) for the latest
   *  performance day. Null when performance.json has no daily rows OR is
   *  missing/errored (degraded mode — all day-P&L fields null together). */
  dayPnl: number | null
  /** The performance.json date dayPnl refers to — may lag latest.asOf. */
  dayPnlDate: string | null
  /** LIVE day P&L (₹ base) summed from member holdings' dayPnl (latest.json —
   *  broker-reported, the freshest view) with the export's same-run FX. Null
   *  when NO member carries a day P&L (the Groww-CAS case) or when
   *  performance.json is missing/errored (degraded mode). For consolidated
   *  this equals latest.totals.dayPnl to rounding (verified live). */
  dayPnlLive: number | null
  /** Simple return % over cost-bearing holdings; null when none exist. */
  simpleReturnPct: number | null
  costCoverage: SegmentCostCoverage
  /** Freshest position timestamp in the segment (max holding asOf). */
  asOf: string | null
  /** Pipeline-authoritative: any constituent platform flagged stale. */
  stale: boolean
  /** Days PAST the platform threshold (clamped ≥ 0), max across constituent
   *  platforms; Infinity for an unparseable timestamp (never claim fresh);
   *  null when latest.asOf is missing. */
  staleDaysPast: number | null
  /** The threshold of the platform that attains staleDaysPast. */
  staleThresholdDays: number
  holdings: readonly Holding[]
  series: SegmentSeries
}

/** The four-segment partition invariant (pure check for the screen). */
export interface SegmentReconciliation {
  /** Σ valueBase over the us + india holdings (independent of valueBase fields). */
  usPlusIndia: number
  /** Σ valueBase over ALL holdings. */
  consolidated: number
  /** Σ valueBase over the RAW groww+sharekhan holdings in latest.holdings —
   *  recomputed INDEPENDENTLY of the cas segment, so a broken segment
   *  predicate or holdings filter can never self-validate. */
  casSum: number
  /** The cas segment's DERIVED valueBase — the field casSum is checked
   *  against (a genuine invariant, not the same array reduced twice). */
  casValueBase: number
  /** RAW count of groww+sharekhan holdings in latest.holdings. */
  casRawCount: number
  /** The cas segment's derived holding count. */
  casCount: number
  matches: {
    /** |usPlusIndia − consolidated| ≤ RECONCILIATION_TOLERANCE (INR). */
    usPlusIndiaEqConsolidated: boolean
    /** |casSum − casValueBase| ≤ RECONCILIATION_TOLERANCE (INR). */
    casEqGrowwSharekhan: boolean
    /** casRawCount === casCount — the segment filtered the same rows the sum
     *  check counted. */
    casCountEqGrowwSharekhan: boolean
  }
}

/** INR rounding tolerance for the reconciliation checks. */
export const RECONCILIATION_TOLERANCE = 1

export interface SegmentsResult {
  segments: readonly SegmentSummary[]
  byId: Record<SegmentId, SegmentSummary>
  reconciliation: SegmentReconciliation
  /** The raw latest performance daily row (the ledger view the dayPnl fields
   *  came from) so the UI can cross-reference the pipeline's global numbers. */
  performanceLatest: PerformanceDaily | null
  /** Reference instant everything was derived against (latest.asOf). */
  asOf: string | null
}

/* ------------------------------------------------------------------ */
/* Derivation helpers                                                  */
/* ------------------------------------------------------------------ */

/** Latest performance daily row (ascending dates, contract-guaranteed). */
export function latestPerformanceDay(performance: Performance): PerformanceDaily | null {
  const daily = performance.daily
  return daily.length > 0 ? (daily[daily.length - 1] ?? null) : null
}

/** One series array must be index-aligned with history.dates — portfolio_series
 *  guarantees it by construction (each platform's value is CARRIED FORWARD on
 *  days it didn't run: a missing platform date means the leg didn't run, NOT
 *  that it hit zero). A broken export (missing key or misaligned length when
 *  dates are present) THROWS a descriptive Error — the workspace ErrorState
 *  surfaces it instead of rendering a flat-zero series. */
function expectAligned(
  name: string,
  values: readonly number[] | undefined,
  n: number,
): readonly number[] {
  if (values === undefined) {
    throw new Error(`history.${name} is missing but dates has ${n} entries — broken export`)
  }
  if (values.length !== n) {
    throw new Error(`history.${name} length ${values.length} != dates length ${n} — broken export`)
  }
  return values
}

/** Base-currency series per segment. us/india use the pipeline's own
 *  byGeography sums (geography-complete by construction); cas sums the
 *  groww + sharekhan byPlatform arrays index-aligned (check:contract asserts
 *  alignment); consolidated uses portfolioValueBase directly. An EMPTY
 *  history (n === 0 — fresh install, no runs yet) returns an empty series,
 *  which the screen's EmptyState owns; anything truncated or missing throws
 *  (see expectAligned) — never a fabricated flat line. */
function segmentSeries(history: History, id: SegmentId): SegmentSeries {
  const dates = history.dates
  const n = dates.length
  if (n === 0) return { dates, values: [] }
  if (id === 'consolidated') {
    return { dates, values: expectAligned('portfolioValueBase', history.portfolioValueBase, n) }
  }
  if (id === 'us') {
    return { dates, values: expectAligned('byGeography.US', history.byGeography['US'], n) }
  }
  if (id === 'india') {
    return { dates, values: expectAligned('byGeography.IN', history.byGeography['IN'], n) }
  }
  const groww = expectAligned('byPlatform.groww', history.byPlatform['groww'], n)
  const sharekhan = expectAligned('byPlatform.sharekhan', history.byPlatform['sharekhan'], n)
  const values = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const g = groww[i]
    const s = sharekhan[i]
    if (g === undefined || s === undefined) {
      throw new Error(`history.byPlatform[${i}] has an undefined element — broken export`)
    }
    values[i] = g + s
  }
  return { dates, values }
}

/** Ledger day P&L per segment from the latest performance day's attribution.
 *  A missing attribution key means that scope had no recorded move that day
 *  (→ 0), never a fabricated number. */
function segmentDayPnl(daily: PerformanceDaily, id: SegmentId): number {
  const geo = daily.attribution.byGeography
  const platform = daily.attribution.byPlatform
  if (id === 'us') return geo['US'] ?? 0
  if (id === 'india') return geo['IN'] ?? 0
  if (id === 'cas') return (platform['groww'] ?? 0) + (platform['sharekhan'] ?? 0)
  return daily.dayPnlBase
}

/** Freshest position timestamp across the segment's holdings (max asOf). */
function maxHoldingAsOf(holdings: readonly Holding[]): string | null {
  let maxMs = Number.NEGATIVE_INFINITY
  let maxIso: string | null = null
  for (const h of holdings) {
    const ms = new Date(h.asOf).getTime()
    if (Number.isNaN(ms)) continue
    if (ms > maxMs) {
      maxMs = ms
      maxIso = h.asOf
    }
  }
  return maxIso
}

/** Segment staleness. `stale` is pipeline-authoritative (latest.platforms —
 *  computed at export time with the real clock; M9 PostgREST serves the same).
 *  `staleDaysPast` is our deterministic client-side measure against the
 *  export's own reference instant (latest.asOf), per platform:
 *  max(0, ageDays − threshold); the segment takes the worst platform.
 *  An unparseable timestamp contributes Infinity (never claim fresh). */
function segmentStaleness(
  latest: Latest,
  holdings: readonly Holding[],
): { stale: boolean; staleDaysPast: number | null; staleThresholdDays: number } {
  const platforms = [...new Set(holdings.map((h) => h.platform))]
  let stale = false
  let worstPast = Number.NEGATIVE_INFINITY
  let worstThreshold = 0
  for (const p of platforms) {
    const status = latest.platforms[p]
    if (status?.stale !== false) stale = true // flag true or record missing
    const ageDays = latest.asOf === null ? null : daysBetweenIso(latest.asOf, status?.asOf ?? null)
    const daysPast = ageDays === null ? Number.POSITIVE_INFINITY : Math.max(0, ageDays - staleThresholdDays(p))
    if (daysPast > worstPast) {
      worstPast = daysPast
      worstThreshold = staleThresholdDays(p)
    }
  }
  if (platforms.length === 0) {
    return { stale: false, staleDaysPast: null, staleThresholdDays: 0 }
  }
  const staleDaysPast = latest.asOf === null ? null : worstPast
  return { stale, staleDaysPast, staleThresholdDays: worstThreshold }
}

/** Display value: sum of valueDisplay only when the segment has exactly one
 *  display currency AND it differs from the portfolio base currency
 *  (US → SGD vs an INR base); null otherwise — India/CAS show valueBase in
 *  INR (displayCurrency equals base, so valueDisplay is redundant there), and
 *  consolidated is mixed (INR + SGD). Per spec, displayValue exists for
 *  non-base display currencies only. */
function segmentDisplay(
  holdings: readonly Holding[],
  baseCurrency: string,
): {
  displayValue: number | null
  displayCurrency: string | null
} {
  const currencies = new Set(holdings.map((h) => h.displayCurrency))
  if (currencies.size !== 1) return { displayValue: null, displayCurrency: null }
  const currency = [...currencies][0] ?? null
  if (currency === null || currency === baseCurrency) {
    return { displayValue: null, displayCurrency: null }
  }
  const displayValue = holdings.reduce((sum, h) => sum + h.valueDisplay, 0)
  return { displayValue, displayCurrency: currency }
}

function buildSegment(
  def: SegmentDefinition,
  latest: Latest,
  history: History,
  daily: PerformanceDaily | null,
  hasPerformance: boolean,
): SegmentSummary {
  const holdings = latest.holdings.filter(def.matches)
  const valueBase = holdings.reduce((sum, h) => sum + h.valueBase, 0)
  const display = segmentDisplay(holdings, latest.baseCurrency)
  const ret = simpleReturn(holdings)
  const staleness = segmentStaleness(latest, holdings)
  const latestDayPnl = daily === null ? null : segmentDayPnl(daily, def.id)
  return {
    id: def.id,
    label: def.label,
    valueBase,
    displayValue: display.displayValue,
    displayCurrency: display.displayCurrency,
    dayPnl: latestDayPnl,
    dayPnlDate: daily === null ? null : daily.date,
    dayPnlLive: hasPerformance ? dayPnlLiveInr(latest, holdings) : null,
    simpleReturnPct: ret.pct,
    costCoverage: { withCost: ret.withCost, noCost: ret.noCost },
    asOf: maxHoldingAsOf(holdings),
    stale: staleness.stale,
    staleDaysPast: staleness.staleDaysPast,
    staleThresholdDays: staleness.staleThresholdDays,
    holdings,
    series: segmentSeries(history, def.id),
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Build the four segments from the contract files. Pure and deterministic —
 *  the same inputs always produce the same segments. `performance` is
 *  OPTIONAL: when null (missing/errored export) the day-P&L fields derive
 *  null together while valueBase/series/returns still come from
 *  latest+history. Throws a descriptive Error on a broken export (see
 *  segmentSeries' expectAligned) — callers surface it via their ErrorState. */
export function buildSegments(
  latest: Latest,
  history: History,
  performance: Performance | null,
): SegmentsResult {
  const daily = performance === null ? null : latestPerformanceDay(performance)
  const hasPerformance = performance !== null
  const segments = SEGMENT_DEFINITIONS.map((def) =>
    buildSegment(def, latest, history, daily, hasPerformance),
  )
  const byId = Object.fromEntries(segments.map((s) => [s.id, s])) as Record<
    SegmentId,
    SegmentSummary
  >
  return {
    segments,
    byId,
    reconciliation: assertReconciliation(segments, latest),
    performanceLatest: daily,
    asOf: latest.asOf,
  }
}

/** The four-segment invariant as a pure check. Values are summed from the
 *  segments' OWN holdings (not their valueBase fields) so a bug in the
 *  valueBase derivation is caught by the matches, not masked by it. The CAS
 *  identity is GENUINE: casSum is recomputed from the RAW latest.holdings
 *  (never from the cas segment's already-filtered rows), so a broken
 *  matches() predicate or holdings filter surfaces here instead of
 *  comparing an array with itself. */
export function assertReconciliation(
  segments: readonly SegmentSummary[],
  latest: Latest,
): SegmentReconciliation {
  const byId = new Map<SegmentId, SegmentSummary>()
  for (const s of segments) byId.set(s.id, s)
  const us = byId.get('us')
  const india = byId.get('india')
  const cas = byId.get('cas')
  const consolidated = byId.get('consolidated')

  const sumValues = (hs: readonly Holding[] | undefined): number =>
    hs ? hs.reduce((sum, h) => sum + h.valueBase, 0) : 0

  const usPlusIndia = sumValues(us?.holdings) + sumValues(india?.holdings)
  const consolidatedValue = sumValues(consolidated?.holdings)

  // INDEPENDENT recompute of the CAS legs straight from the contract
  // holdings — the previous code reduced `cas?.holdings` twice, so the check
  // could never fail even if the cas predicate were broken. Compare BOTH the
  // sum and the count against the segment's derived fields.
  const rawCasHoldings = latest.holdings.filter(
    (h) => h.platform === 'groww' || h.platform === 'sharekhan',
  )
  const casSum = rawCasHoldings.reduce((sum, h) => sum + h.valueBase, 0)
  const casValueBase = cas?.valueBase ?? 0
  const casRawCount = rawCasHoldings.length
  const casCount = cas?.holdings.length ?? 0

  return {
    usPlusIndia,
    consolidated: consolidatedValue,
    casSum,
    casValueBase,
    casRawCount,
    casCount,
    matches: {
      usPlusIndiaEqConsolidated:
        Math.abs(usPlusIndia - consolidatedValue) <= RECONCILIATION_TOLERANCE,
      casEqGrowwSharekhan: Math.abs(casSum - casValueBase) <= RECONCILIATION_TOLERANCE,
      casCountEqGrowwSharekhan: casRawCount === casCount,
    },
  }
}

/** React hook — one query per contract file (data.ts conventions), then a pure
 *  buildSegments pass. performance.json is OPTIONAL: the workspace renders as
 *  soon as latest + history load, with day P&L null until performance arrives
 *  (and null forever when it 404s — the honest "—" state, never a null
 *  workspace). A buildSegments throw (a genuinely broken export — see
 *  segmentSeries' expectAligned) is caught and surfaced via isError so
 *  SegmentsScreen shows the ErrorState with the exact cause instead of a
 *  white-screen crash. isLoading/isError reflect latest+history ONLY. */
export function useSegments(): {
  data: SegmentsResult | null
  isLoading: boolean
  isError: boolean
  /** The caught derivation error (broken export), shown in the ErrorState. */
  error: string | null
} {
  const latest = useLatest()
  const history = useHistory()
  const performance = usePerformance()

  // Derive on every render: buildSegments is O(holdings × segments) over
  // <100 rows, so memoization buys nothing — and a try/catch here lets a
  // broken export surface as isError instead of crashing the app.
  let data: SegmentsResult | null = null
  let derivationError: string | null = null
  if (latest.data && history.data) {
    try {
      data = buildSegments(latest.data, history.data, performance.data ?? null)
    } catch (e) {
      derivationError = e instanceof Error ? e.message : String(e)
    }
  }

  return {
    data,
    error: derivationError,
    isLoading: latest.isLoading || history.isLoading,
    isError: latest.isError || history.isError || derivationError !== null,
  }
}