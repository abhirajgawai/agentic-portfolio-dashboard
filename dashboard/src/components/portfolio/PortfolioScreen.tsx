/**
 * PortfolioScreen — the unified Portfolio tab (spec-round2/Portfolio tab).
 * Merges the best of HoldingsView + SegmentsScreen into ONE tab:
 *
 *   - Segment Cards Grid (1 featured Consolidated + 3 compact: US, India, CAS)
 *     Click any card → filters table + writes cross-filter to FilterProvider
 *   - Reconciliation Bar (always visible, bottom of cards)
 *     US + India = Consolidated ✓/⚠ | Groww + Sharekhan = CAS ✓/⚠
 *   - Unified Holdings Table (reuses HoldingsTable)
 *     Segment dropdown: [Consolidated ▼] [US] [India] [CAS]
 *     Search box (ticker/name/platform)
 *     Sortable columns, sparklines, privacy mask
 *     perRowCurrency when segment has mixed currencies
 *     Platform column visible when segment has >1 platform
 *     Click row → HoldingDossier (setTransientDossier)
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
import { usePrivacy } from '@/lib/privacy'
import { type TransientDossier, type WorkspaceId } from '@/lib/workspaces'
import type { Latest } from '@/types/contract'
import { formatInrCompact, MASK_TEXT, formatAsOf } from '@/lib/format'
import { cn } from '@/lib/utils'

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
  if (id === 'cas') return { ...EMPTY_FILTERS(), platform: new Set(['groww', 'sharekhan']) }
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
    { id: 'cas', label: 'Groww-CAS' },
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
  const { replaceFilters } = useFilters()
  const [selectedSegmentId, setSelectedSegmentId] = useState<SegmentId>('consolidated')

  // Build a stable reference to selected segment data
  const selectedSegment = useMemo(
    () => (data ? (data.byId[selectedSegmentId] ?? null) : null),
    [data, selectedSegmentId],
  )

  // Platform metadata for the selected segment
  const mixedCurrency = useMemo(
    () => selectedSegment ? new Set(selectedSegment.holdings.map((h) => h.displayCurrency)).size > 1 : false,
    [selectedSegment],
  )
  const multiPlatform = useMemo(
    () => selectedSegment ? new Set(selectedSegment.holdings.map((h) => h.platform)).size > 1 : false,
    [selectedSegment],
  )

  // Stable holdings array for HoldingsTable (memoization key)
  const stableHoldings = useMemo(() => selectedSegment ? [...selectedSegment.holdings] : [], [selectedSegment])

  // Live-region announcement (final state only, memoized on data identity)
  const announce = useMemo(() => {
    const featured = data?.byId['consolidated']
    if (!featured) return ''
    return (
      `Portfolio loaded. ${featured.holdings.length} holdings. ` +
      `Identity: US plus India equals consolidated — ${data.reconciliation.matches.usPlusIndiaEqConsolidated ? 'exact' : 'differs'}. ` +
      `Groww plus Sharekhan equals Groww-CAS — ${data.reconciliation.matches.casEqGrowwSharekhan && data.reconciliation.matches.casCountEqGrowwSharekhan ? 'exact' : 'differs'}.`
    )
  }, [data])

  // Display currency for the selected segment (INR for INR legs, SGD for US)
  const displayCurrency = useMemo(() => {
    if (!selectedSegment) return 'INR'
    if (selectedSegment.id === 'us') return 'SGD'
    return selectedSegment.displayCurrency ?? 'INR'
  }, [selectedSegment])

  // Real estate value for honesty footnote (India segment)
  const realEstateValue = useMemo(
    () =>
      selectedSegment?.holdings
        .filter((h) => h.platform === 'real_estate')
        .reduce((sum, h) => sum + h.valueBase, 0) ?? 0,
    [selectedSegment],
  )

  // Account currency day P&L for US segment (from latest.totals)
  const accountPnlSgd = useMemo(() => {
    if (selectedSegmentId !== 'us' || !latestData) return null
    return latestData.totals.dayPnlByAccountCurrency['SGD'] ?? null
  }, [selectedSegmentId, latestData])

  // Handle card click: write cross-filter + switch selected segment
  const selectSegment = (id: SegmentId) => {
    replaceFilters(filtersForSegment(id))
    setSelectedSegmentId(id)
  }

  const handleDossierSelect = (ticker: string) => {
    setTransientDossier({ ticker, previousWorkspace: 'portfolio' as WorkspaceId })
  }

  // Handle clear filter button
  const handleClearFilter = () => {
    replaceFilters(EMPTY_FILTERS())
    setSelectedSegmentId('consolidated')
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
            active={selectedSegmentId === 'consolidated'}
            masked={masked}
            onOpen={() => selectSegment('consolidated')}
          />
        )}
      </Entrance>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {(['us', 'india', 'cas'] as const).map((id, i) => {
          const seg = data.byId[id]
          if (!seg) return null
          return (
            <Entrance key={id} index={i + 1}>
              <SegmentCard
                segment={seg}
                variant="default"
                active={selectedSegmentId === id}
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
        {selectedSegmentId !== 'consolidated' && (
          <Button variant="outline" size="sm" onClick={handleClearFilter}>
            Clear segment filter
          </Button>
        )}
      </div>

      {/* Holdings Table (filtered to selected segment) */}
      {selectedSegment ? (
        <HoldingsTable
          holdings={stableHoldings}
          displayCurrency={displayCurrency}
          perRowCurrency={mixedCurrency}
          platformVisible={multiPlatform}
          showSparkline
          onSelect={handleDossierSelect}
        />
      ) : (
        <EmptyState title="No holdings in this segment" description="Select a different segment or run a snapshot." />
      )}

      {/* Honesty footnotes (from SegmentBreakdown) */}
      <ul className="space-y-1 text-[11px] text-muted-foreground">
        <li>
          Day P&L covers live legs only (zerodha/moomoo). CAS rows re-price on monthly import —
          never a one-day move.
        </li>
        <li>
          Return covers {selectedSegment?.costCoverage.withCost ?? 0} of {selectedSegment?.holdings.length ?? 0} holdings with
          cost basis (CAS value-only rows are excluded from return math).
        </li>
        {selectedSegmentId === 'cas' && (
          <li>
            Refreshed by monthly CAS import + daily AMFI NAV — the Refresh button never touches
            this leg.
          </li>
        )}
        {selectedSegmentId === 'india' && realEstateValue > 0 && (
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