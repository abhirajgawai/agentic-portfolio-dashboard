/**
 * PortfolioScreen — the unified Portfolio tab (spec-round2/Portfolio tab).
 * Merges the best of HoldingsView + SegmentsScreen into ONE tab:
 *
 *   - Segment Cards Grid (1 featured Consolidated + 2 compact: US, India)
 *     Click any card → filters table + writes cross-filter to FilterProvider
 *   - Compact platform/asset-class breakdown row (Zerodha / Moomoo / Groww MF /
 *     Groww Equities / Sharekhan / Real Estate) — a FINER partition than the
 *     segment cards, built directly on FilterProvider's generic filters
 *     rather than the segments.ts module (no day-P&L/series/staleness needed
 *     for a value-only breakdown row). Superseded the old "Groww-CAS" segment
 *     card, which this breakdown already covers at finer granularity within
 *     India (see segments.ts's header comment for the removal rationale).
 *   - Reconciliation Bar (always visible, bottom of cards): US + India = Consolidated ✓/⚠
 *   - Unified Holdings Table (reuses HoldingsTable)
 *     Segment dropdown: [Consolidated ▼] [US] [India]
 *     Search box (ticker/name/platform)
 *     Sortable columns, sparklines, privacy mask
 *     perRowCurrency when the current selection has mixed currencies
 *     Platform column visible when the current selection has >1 platform
 *     Click row → HoldingDossier (setTransientDossier)
 *
 * The table is ALWAYS driven by FilterProvider's `filteredHoldings` (not a
 * segment's own `.holdings`) — segment-card clicks and breakdown-bucket
 * clicks both just call `replaceFilters(...)`, so both mechanisms feed the
 * table through the exact same generic path (filtersForSegment('us') and the
 * 'us' segment's own `matches` predicate are equivalent, so this changes
 * nothing for the existing segment cards while making breakdown buckets work
 * without needing segment-shaped objects for them).
 *
 * Reuses EXISTING components exactly as-is:
 *   SegmentCard, SegmentReconcileBar, HoldingsTable, useSegments, useLatest,
 *   usePrivacy, FilterProvider/useFilters, format helpers.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

import { SegmentCard } from '@/components/segments/SegmentCard'
import { SegmentReconcileBar } from '@/components/segments/SegmentReconcileBar'
import { HoldingsTable } from '@/components/holdings/HoldingsTable'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, LoadingState } from '@/components/layout/states'
import { FilterProvider, type ActiveFilters } from '@/lib/filter-context'
import { useFilters } from '@/lib/filter-context'
import { useLatest } from '@/lib/data'
import { useSegments, type SegmentId, type SegmentsResult } from '@/lib/segments'
import { simpleReturn } from '@/lib/returns'
import { usePrivacy } from '@/lib/privacy'
import { type TransientDossier, type WorkspaceId } from '@/lib/workspaces'
import type { Holding, Latest } from '@/types/contract'
import { formatInrCompact, MASK_TEXT, formatAsOf } from '@/lib/format'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Compact platform/asset-class breakdown (finer than the segment cards) */
/* ------------------------------------------------------------------ */

type BreakdownId = 'zerodha' | 'moomoo' | 'groww_mf' | 'groww_equity' | 'sharekhan' | 'real_estate'

interface BreakdownBucket {
  id: BreakdownId
  label: string
  matches: (h: Holding) => boolean
  filters: ActiveFilters
}

/** A filter set with only `platform` (+ optionally `assetClass`) populated —
 *  a local literal, not the EMPTY_FILTERS() helper below, so this module-level
 *  const has no declaration-order dependency on it. */
function platformFilter(platforms: string[], assetClasses: string[] = []): ActiveFilters {
  return {
    geography: new Set(),
    platform: new Set(platforms),
    sector: new Set(),
    assetClass: new Set(assetClasses),
  }
}

const BREAKDOWN_BUCKETS: readonly BreakdownBucket[] = [
  {
    id: 'zerodha',
    label: 'Zerodha',
    matches: (h) => h.platform === 'zerodha',
    filters: platformFilter(['zerodha']),
  },
  {
    id: 'moomoo',
    label: 'Moomoo',
    matches: (h) => h.platform === 'moomoo',
    filters: platformFilter(['moomoo']),
  },
  {
    id: 'groww_mf',
    label: 'Groww MF',
    matches: (h) => h.platform === 'groww' && (h.assetClass === 'mutual_fund' || h.assetClass === 'etf'),
    filters: platformFilter(['groww'], ['mutual_fund', 'etf']),
  },
  {
    id: 'groww_equity',
    label: 'Groww Equities',
    matches: (h) => h.platform === 'groww' && h.assetClass === 'equity',
    filters: platformFilter(['groww'], ['equity']),
  },
  {
    id: 'sharekhan',
    label: 'Sharekhan',
    matches: (h) => h.platform === 'sharekhan',
    filters: platformFilter(['sharekhan']),
  },
  {
    id: 'real_estate',
    label: 'Real Estate',
    matches: (h) => h.platform === 'real_estate',
    filters: platformFilter(['real_estate']),
  },
]

function BreakdownRow({
  holdings,
  masked,
  activeBucketId,
  onSelect,
}: {
  holdings: readonly Holding[]
  masked: boolean
  activeBucketId: BreakdownId | null
  onSelect: (bucket: BreakdownBucket) => void
}) {
  const rows = useMemo(
    () =>
      BREAKDOWN_BUCKETS.map((b) => ({
        bucket: b,
        value: holdings.filter(b.matches).reduce((sum, h) => sum + h.valueBase, 0),
      })).filter((r) => r.value > 0),
    [holdings],
  )
  if (rows.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {rows.map(({ bucket, value }) => (
        <button
          key={bucket.id}
          type="button"
          onClick={() => onSelect(bucket)}
          className={cn(
            'rounded-full border px-2.5 py-1 font-medium tabular-nums transition-colors',
            activeBucketId === bucket.id
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/50',
          )}
        >
          {bucket.label} <span className="opacity-70">{masked ? MASK_TEXT : formatInrCompact(value)}</span>
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Entrance stagger (motion-spec §1 — fade + 6px rise, 300ms, 60ms apart) */
/* prefers-reduced-motion renders statically via global CSS rule.        */
/* ------------------------------------------------------------------ */

function Entrance({
  index = 0,
  className,
  children,
}: {
  index?: number
  className?: string
  children: ReactNode
}) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), 30)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <div
      className={cn(
        'transition-all duration-300 ease-out motion-reduce:transition-none motion-reduce:translate-y-0 motion-reduce:opacity-100',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0',
        className,
      )}
      style={{ transitionDelay: `${index * 60}ms` }}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Filter semantics (§4.2 — exact filter sets per segment)            */
/* ------------------------------------------------------------------ */

const EMPTY_FILTERS = (): ActiveFilters => ({
  geography: new Set(),
  platform: new Set(),
  sector: new Set(),
  assetClass: new Set(),
})

/** The exact filter set a segment card click writes (replace-all). */
function filtersForSegment(id: SegmentId): ActiveFilters {
  if (id === 'us') return { ...EMPTY_FILTERS(), geography: new Set(['US']) }
  if (id === 'india') return { ...EMPTY_FILTERS(), geography: new Set(['IN']) }
  return EMPTY_FILTERS()
}

/* ------------------------------------------------------------------ */
/* Segment Selector (dropdown/button group)                           */
/* ------------------------------------------------------------------ */

interface SegmentSelectorProps {
  value: SegmentId
  onChange: (id: SegmentId) => void
  segments: SegmentsResult['segments']
}

function SegmentSelector({ value, onChange, segments }: SegmentSelectorProps) {
  const byId = useMemo(() => Object.fromEntries(segments.map((s) => [s.id, s])), [segments])
  const options: { id: SegmentId; label: string }[] = [
    { id: 'consolidated', label: 'Consolidated' },
    { id: 'us', label: 'US' },
    { id: 'india', label: 'India' },
  ]

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="segment-select" className="text-xs text-muted-foreground">
        Segment
      </label>
      <select
        id="segment-select"
        value={value}
        onChange={(e) => onChange(e.target.value as SegmentId)}
        className="h-8 rounded-md border bg-background px-2 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((opt) => {
          const seg = byId[opt.id]
          return (
            <option key={opt.id} value={opt.id}>
              {seg ? `${opt.label} (${seg.holdings.length})` : opt.label}
            </option>
          )
        })}
      </select>
      <ChevronDown className="size-4 text-muted-foreground pointer-events-none" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Inner component — rendered INSIDE FilterProvider so useFilters works */
/* ------------------------------------------------------------------ */

interface PortfolioScreenInnerProps {
  data: SegmentsResult
  masked: boolean
  latestData: Latest | null
  setTransientDossier: (d: Partial<TransientDossier>) => void
}

function PortfolioScreenInner({
  data,
  masked,
  latestData,
  setTransientDossier,
}: PortfolioScreenInnerProps) {
  const { replaceFilters, filteredHoldings } = useFilters()
  const [selectedSegmentId, setSelectedSegmentId] = useState<SegmentId>('consolidated')
  const [activeBucketId, setActiveBucketId] = useState<BreakdownId | null>(null)

  // The segment object backing the featured/compact cards' OWN numbers
  // (day P&L, series, staleness) — unrelated to what drives the table below.
  const selectedSegment = useMemo(
    () => (data ? (data.byId[selectedSegmentId] ?? null) : null),
    [data, selectedSegmentId],
  )

  // The table is ALWAYS driven by FilterProvider's generic filteredHoldings —
  // both segment-card clicks and breakdown-bucket clicks just call
  // replaceFilters(...), so this one array covers both mechanisms.
  const tableHoldings = filteredHoldings

  const mixedCurrency = useMemo(
    () => new Set(tableHoldings.map((h) => h.displayCurrency)).size > 1,
    [tableHoldings],
  )
  const multiPlatform = useMemo(
    () => new Set(tableHoldings.map((h) => h.platform)).size > 1,
    [tableHoldings],
  )
  const costCoverage = useMemo(() => simpleReturn(tableHoldings), [tableHoldings])

  // Live-region announcement (final state only, memoized on data identity)
  const announce = useMemo(() => {
    const featured = data?.byId['consolidated']
    if (!featured) return ''
    return (
      `Portfolio loaded. ${featured.holdings.length} holdings. ` +
      `Identity: US plus India equals consolidated — ${data.reconciliation.matches.usPlusIndiaEqConsolidated ? 'exact' : 'differs'}.`
    )
  }, [data])

  // Display currency: SGD for the US segment or the Moomoo breakdown bucket
  // (both are US-geography-only), INR base otherwise.
  const displayCurrency = useMemo(() => {
    if (activeBucketId === 'moomoo') return 'SGD'
    if (!activeBucketId && selectedSegment?.id === 'us') return 'SGD'
    return selectedSegment?.displayCurrency ?? 'INR'
  }, [activeBucketId, selectedSegment])

  // Real estate value for honesty footnote (India segment)
  const realEstateValue = useMemo(
    () => tableHoldings.filter((h) => h.platform === 'real_estate').reduce((sum, h) => sum + h.valueBase, 0),
    [tableHoldings],
  )

  // Account currency day P&L for US segment (from latest.totals)
  const accountPnlSgd = useMemo(() => {
    if (selectedSegmentId !== 'us' || activeBucketId || !latestData) return null
    return latestData.totals.dayPnlByAccountCurrency['SGD'] ?? null
  }, [selectedSegmentId, activeBucketId, latestData])

  // Handle card click: write cross-filter + switch selected segment
  const selectSegment = (id: SegmentId) => {
    replaceFilters(filtersForSegment(id))
    setSelectedSegmentId(id)
    setActiveBucketId(null)
  }

  // Handle breakdown-bucket click: same cross-filter mechanism as a segment
  // card, mutually exclusive with segment selection (visual "active" state).
  const selectBucket = (bucket: BreakdownBucket) => {
    replaceFilters(bucket.filters)
    setActiveBucketId(bucket.id)
  }

  const handleDossierSelect = (ticker: string) => {
    setTransientDossier({ ticker, previousWorkspace: 'portfolio' as WorkspaceId })
  }

  // Handle clear filter button
  const handleClearFilter = () => {
    replaceFilters(EMPTY_FILTERS())
    setSelectedSegmentId('consolidated')
    setActiveBucketId(null)
  }

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Portfolio</h1>
      {/* Final-state announcement only (aria-live=polite) */}
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>

      {/* Segment Cards Grid */}
      <Entrance index={0}>
        {data.byId['consolidated'] && (
          <SegmentCard
            segment={data.byId['consolidated']!}
            variant="featured"
            active={selectedSegmentId === 'consolidated' && !activeBucketId}
            masked={masked}
            onOpen={() => selectSegment('consolidated')}
          />
        )}
      </Entrance>

      {/* Compact platform/asset-class breakdown — finer than the segment
          cards below, sits right under the consolidated total. */}
      <Entrance index={1}>
        <BreakdownRow
          holdings={latestData?.holdings ?? []}
          masked={masked}
          activeBucketId={activeBucketId}
          onSelect={selectBucket}
        />
      </Entrance>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(['us', 'india'] as const).map((id, i) => {
          const seg = data.byId[id]
          if (!seg) return null
          return (
            <Entrance key={id} index={i + 2}>
              <SegmentCard
                segment={seg}
                variant="default"
                active={selectedSegmentId === id && !activeBucketId}
                masked={masked}
                accountPnlSgd={id === 'us' ? accountPnlSgd : null}
                onOpen={() => selectSegment(id)}
              />
            </Entrance>
          )
        })}
      </div>

      {/* Reconciliation Bar (always visible) */}
      <Entrance index={4}>
        <SegmentReconcileBar segments={data.segments} reconciliation={data.reconciliation} />
      </Entrance>

      {/* Segment Selector + Clear Filter */}
      <div className="flex items-center justify-between">
        <SegmentSelector value={selectedSegmentId} onChange={selectSegment} segments={data.segments} />
        {(selectedSegmentId !== 'consolidated' || activeBucketId) && (
          <Button variant="outline" size="sm" onClick={handleClearFilter}>
            Clear filter
          </Button>
        )}
      </div>

      {/* Holdings Table (filtered to the active segment or breakdown bucket) */}
      {tableHoldings.length > 0 ? (
        <HoldingsTable
          holdings={tableHoldings}
          displayCurrency={displayCurrency}
          perRowCurrency={mixedCurrency}
          platformVisible={multiPlatform}
          showSparkline
          onSelect={handleDossierSelect}
        />
      ) : (
        <EmptyState title="No holdings in this selection" description="Select a different segment/bucket or run a snapshot." />
      )}

      {/* Honesty footnotes (from SegmentBreakdown) */}
      <ul className="space-y-1 text-[11px] text-muted-foreground">
        <li>
          Day P&L covers live legs only (zerodha/moomoo). CAS-derived rows re-price on monthly
          import — never a one-day move.
        </li>
        <li>
          Return covers {costCoverage.withCost} of {tableHoldings.length} holdings with
          cost basis (value-only rows — CAS equities, manual Groww/Sharekhan totals — are excluded
          from return math).
        </li>
        {selectedSegmentId === 'india' && !activeBucketId && realEstateValue > 0 && (
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
        <li>
          As of {formatAsOf(selectedSegment?.asOf ?? latestData?.asOf ?? null)}
        </li>
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Outer Screen — data fetching, loading/error, FilterProvider wrapper  */
/* ------------------------------------------------------------------ */

interface PortfolioScreenProps {
  /** Holding-row select → HoldingDossier hop (setTransientDossier seam). */
  setTransientDossier: (d: Partial<TransientDossier>) => void
}

export function PortfolioScreen({ setTransientDossier }: PortfolioScreenProps) {
  const segments = useSegments()
  const latest = useLatest()
  const { masked } = usePrivacy()

  const isLoading = segments.isLoading || latest.isLoading
  const isError = segments.isError || latest.isError

  const data = segments.data
  const latestData = latest.data
  const allHoldings = latestData?.holdings ?? []

  // Loading / Error / Empty states
  if (isLoading) return <LoadingState label="Loading portfolio…" />
  if (isError || !data) {
    return (
      <ErrorState message={segments.error ?? 'Portfolio segments could not be derived from the latest export.'} />
    )
  }
  if (allHoldings.length === 0) {
    return (
      <EmptyState
        title="No holdings yet"
        description="Run a snapshot and export to see your portfolio segments here."
      />
    )
  }

  return (
    <FilterProvider holdings={allHoldings}>
      <PortfolioScreenInner
        data={data}
        masked={masked}
        latestData={latestData ?? null}
        setTransientDossier={setTransientDossier}
      />
    </FilterProvider>
  )
}