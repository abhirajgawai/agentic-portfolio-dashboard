/**
 * SegmentBreakdown — the drill-down for one segment (spec-round2/
 * segments-workspace §4). Composes existing primitives: HoldingsTable, Badge,
 * Button, Card, breadcrumb (dossier pattern). Uses segment membership DIRECTLY
 * (not the context filter), so it stays correct even if the user clears
 * filters afterward.
 *
 * Interactions (§4.1): platform rows write the platform cross-filter
 * (replace-all of the platform dimension, other dimensions unchanged);
 * holding rows open the HoldingDossier via setTransientDossier. Esc returns to
 * the grid (filters stay); focus lands on the breadcrumb on mount.
 *
 * Honesty (§4.3): fixed, data-driven footnotes — day P&L is live-legs only;
 * return coverage counts cost-bearing holdings; Groww-CAS "Refresh never
 * touches this leg"; India "incl. real estate (manually revalued)".
 */

import { useEffect, useMemo, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { HoldingsTable } from '@/components/holdings/HoldingsTable'
import { useFilters } from '@/lib/filter-context'
import { useLatest } from '@/lib/data'
import { dayPnlLiveInr, staleThresholdDays, type SegmentSummary } from '@/lib/segments'
import { simpleReturn } from '@/lib/returns'
import { formatAsOf, formatInrCompact, MASK_TEXT, platformLabel } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { cn } from '@/lib/utils'
import type { Holding, Latest } from '@/types/contract'

const MS_PER_DAY = 86_400_000

/** Days between two ISO timestamps; null when either is missing/unparseable.
 *  Deterministic — both come from the data files, never the wall clock. */
function daysBetweenIso(afterIso: string | null, beforeIso: string | null): number | null {
  if (!afterIso || !beforeIso) return null
  const after = new Date(afterIso)
  const before = new Date(beforeIso)
  if (Number.isNaN(after.getTime()) || Number.isNaN(before.getTime())) return null
  return (after.getTime() - before.getTime()) / MS_PER_DAY
}

/** platformLabel + the snake_case special case (real_estate → "Real estate"). */
function platformDisplay(platform: string): string {
  return platform === 'real_estate' ? 'Real estate' : platformLabel(platform)
}

/** One platform summary row (computed from segment membership). */
interface PlatformRow {
  platform: string
  count: number
  valueBase: number
  /** valueBase(platform) / valueBase(segment) × 100, 1dp. */
  pctOfSegment: number
  returnPct: number | null
  withCost: number
  /** Broker-live day P&L in ₹ (same fx formula as the cards —
   *  dayPnlLiveInr, never a second conversion). */
  dayPnl: number | null
  asOf: string | null
  stale: boolean
  /** Days past the platform's staleness threshold (Infinity = unknown age). */
  daysPast: number
}

/** Platform summary rows from the segment's OWN holdings (never the context
 *  filter, so the breakdown survives a later filter clear). */
function buildPlatformRows(latestData: Latest, segment: SegmentSummary): PlatformRow[] {
  const byPlatform = new Map<string, Holding[]>()
  for (const h of segment.holdings) {
    const arr = byPlatform.get(h.platform)
    if (arr) arr.push(h)
    else byPlatform.set(h.platform, [h])
  }
  return [...byPlatform.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([platform, hs]): PlatformRow => {
      const valueBase = hs.reduce((sum, h) => sum + h.valueBase, 0)
      const ret = simpleReturn(hs)
      const status = latestData.platforms[platform]
      const ageDays = latestData.asOf === null ? null : daysBetweenIso(latestData.asOf, status?.asOf ?? null)
      const daysPast =
        ageDays === null ? Number.POSITIVE_INFINITY : Math.max(0, ageDays - staleThresholdDays(platform))
      return {
        platform,
        count: hs.length,
        valueBase,
        pctOfSegment: segment.valueBase > 0 ? (valueBase / segment.valueBase) * 100 : 0,
        returnPct: ret.pct,
        withCost: ret.withCost,
        dayPnl: dayPnlLiveInr(latestData, hs),
        asOf: hs.reduce<string | null>((max, h) => {
          const t = new Date(h.asOf).getTime()
          if (Number.isNaN(t)) return max
          if (max === null) return h.asOf
          return new Date(max).getTime() > t ? max : h.asOf
        }, null),
        stale: status?.stale !== false,
        daysPast,
      }
    })
}

interface SegmentBreakdownProps {
  segment: SegmentSummary
  onBack: () => void
  /** Holding-row select → HoldingDossier hop (setTransientDossier). */
  onDossierSelect: (ticker: string) => void
}

export function SegmentBreakdown({ segment, onBack, onDossierSelect }: SegmentBreakdownProps) {
  const latest = useLatest()
  const { masked } = usePrivacy()
  const { activeFilters, replaceFilters, clearFilters } = useFilters()
  const backRef = useRef<HTMLButtonElement>(null)

  const hasActiveFilters = Object.values(activeFilters).some((s) => s.size > 0)

  // Focus the breadcrumb on open (dossier pattern, spec §4.1).
  useEffect(() => {
    backRef.current?.focus()
  }, [])

  // Esc returns to the grid; filters stay (honest — the universe keeps showing
  // the segment until the user clears it).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onBack])

  const latestData = latest.data
  const rows = useMemo(
    () => (latestData ? buildPlatformRows(latestData, segment) : []),
    [latestData, segment],
  )
  const mixedCurrency = useMemo(
    () => new Set(segment.holdings.map((h) => h.displayCurrency)).size > 1,
    [segment.holdings],
  )
  const realEstateValue = useMemo(
    () =>
      segment.holdings
        .filter((h) => h.platform === 'real_estate')
        .reduce((sum, h) => sum + h.valueBase, 0),
    [segment.holdings],
  )

  // Stabilize the holdings array reference so HoldingsTable's internal
  // memoization (stableData, sparklineOptions, columns) works correctly.
  // segment.holdings is readonly; spread to mutable for HoldingsTable contract.
  const stableHoldings = useMemo(() => [...segment.holdings], [segment.holdings])

  const pnl = segment.dayPnlLive
  const ret = segment.simpleReturnPct

  return (
    <div className="space-y-4">
      {/* Breadcrumb (dossier pattern) */}
      <button
        ref={backRef}
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-3.5" /> Segments / {segment.label}
      </button>

      {/* Header: segment facts + clear-filter escape hatch */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{segment.label} segment</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{segment.holdings.length} holdings</span>
            <span className="tabular-nums">
              {masked ? MASK_TEXT : formatInrCompact(segment.valueBase)}
            </span>
            {pnl !== null && (
              <span className={cn('tabular-nums', pnl >= 0 ? 'text-gain' : 'text-loss')}>
                Day {masked ? MASK_TEXT : `${pnl >= 0 ? '+' : ''}${formatInrCompact(pnl)}`}
              </span>
            )}
            {ret !== null && (
              <span className="tabular-nums">
                {ret >= 0 ? '+' : ''}
                {ret.toFixed(1)}% ({segment.costCoverage.withCost}/{segment.holdings.length} with
                cost)
              </span>
            )}
          </p>
        </div>
        {hasActiveFilters && (
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Clear segment filter
          </Button>
        )}
      </div>

      {/* Platform summary (per member platform) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">By platform</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">Platform</th>
                <th className="px-2 py-1.5 text-right font-medium">Holdings</th>
                <th className="px-2 py-1.5 text-right font-medium">Value (₹)</th>
                <th className="px-2 py-1.5 text-right font-medium">% of segment</th>
                <th className="px-2 py-1.5 text-right font-medium">Return*</th>
                <th className="px-2 py-1.5 text-right font-medium">Day P&L</th>
                <th className="px-2 py-1.5 text-right font-medium">asOf</th>
                <th className="px-2 py-1.5 text-right font-medium">Freshness</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.platform} className="border-b border-border/30 last:border-0">
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        replaceFilters({ ...activeFilters, platform: new Set([r.platform]) })
                      }
                      className="rounded px-1 py-0.5 font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={`Filter universe to ${platformDisplay(r.platform)}`}
                    >
                      {platformDisplay(r.platform)}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.count}</td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                    {masked ? MASK_TEXT : formatInrCompact(r.valueBase)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.pctOfSegment.toFixed(1)}%
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1.5 text-right tabular-nums',
                      r.returnPct === null
                        ? 'text-muted-foreground'
                        : r.returnPct >= 0
                          ? 'text-gain'
                          : 'text-loss',
                    )}
                  >
                    {r.returnPct === null
                      ? '—'
                      : `${r.returnPct >= 0 ? '+' : ''}${r.returnPct.toFixed(1)}%`}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1.5 text-right tabular-nums',
                      r.dayPnl === null
                        ? 'text-muted-foreground'
                        : r.dayPnl >= 0
                          ? 'text-gain'
                          : 'text-loss',
                    )}
                  >
                    {r.dayPnl === null
                      ? '—'
                      : masked
                        ? MASK_TEXT
                        : `${r.dayPnl >= 0 ? '+' : ''}${formatInrCompact(r.dayPnl)}`}
                  </td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">
                    {formatAsOf(r.asOf)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <span
                      className="inline-flex items-center gap-1 text-muted-foreground"
                      title={
                        Number.isFinite(r.daysPast) && r.daysPast > 0
                          ? `${platformDisplay(r.platform)}: ${Math.round(r.daysPast)}d past its ${staleThresholdDays(r.platform)}d threshold`
                          : `${platformDisplay(r.platform)}: within its ${staleThresholdDays(r.platform)}d threshold`
                      }
                    >
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          r.stale ? 'bg-warning' : 'bg-gain',
                        )}
                      />
                      {r.stale ? 'stale' : 'fresh'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Full segment holdings — reuse HoldingsTable with the segment's own rows
       * (copy to a mutable array — HoldingsTable takes Holding[] by contract) */}
      <HoldingsTable
        holdings={stableHoldings}
        displayCurrency={segment.displayCurrency ?? 'INR'}
        perRowCurrency={mixedCurrency}
        platformVisible={new Set(segment.holdings.map((h) => h.platform)).size > 1}
        showSparkline
        onSelect={onDossierSelect}
      />

      {/* Honesty footnotes (fixed + data-driven, spec §4.3) */}
      <ul className="space-y-1 text-[11px] text-muted-foreground">
        <li>
          Day P&L covers live legs only (zerodha/moomoo). CAS rows re-price on monthly import —
          never a one-day move.
        </li>
        <li>
          Return covers {segment.costCoverage.withCost} of {segment.holdings.length} holdings with
          cost basis (CAS value-only rows are excluded from return math).
        </li>
        {segment.id === 'cas' && (
          <li>
            Refreshed by monthly CAS import + daily AMFI NAV — the Refresh button never touches
            this leg.
          </li>
        )}
        {segment.id === 'india' && realEstateValue > 0 && (
          <li>
            Includes real estate ({masked ? MASK_TEXT : formatInrCompact(realEstateValue)}) —
            manually revalued.
          </li>
        )}
        {mixedCurrency && (
          <li>
            Value column shows each holding&apos;s account display currency (moomoo rows in SGD).
          </li>
        )}
      </ul>
    </div>
  )
}