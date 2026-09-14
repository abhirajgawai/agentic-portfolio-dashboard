/**
 * SegmentsScreen — the Segments workspace root (spec-round2/segments-workspace
 * §8). Composes SegmentCard ×4 (Consolidated featured), SegmentReconcileBar,
 * SegmentBreakdown, and the shared Loading/Error/Empty states.
 *
 * Structure:
 *   - ONE selectedId at screen level (grid ⇄ breakdown); Esc lives in the
 *     breakdown, filter writes stay in the local FilterProvider.
 *   - Local <FilterProvider> bound to the latest holdings. The three-pane
 *     shell (ContextRail + UniversePane) is not wired into this workspace, so
 *     the segments' filter WRITES land in the local provider and the
 *     cross-filters-active note surfaces when they hold values.
 *   - Read-highlight (§1.2): segmentFilterMatch() recognizes the EXACT filter
 *     sets the card clicks produce — US → geography:{US}, India →
 *     geography:{IN}, CAS → platform:{groww,sharekhan}, Consolidated → none.
 *     A subset or superset rings nothing. Last write wins (never both).
 *
 * Honesty (§8 states): the empty state appears only when the export truly has
 * zero holdings; the reconciliation live region announces the two identity
 * checks on mount and on refresh (final state only, memoized on data identity).
 *
 * A11y (§7.2): sr-only h1, role="status" aria-live="polite" announcement,
 * whole-card buttons with aria-pressed (SegmentCard), Esc returns from the
 * breakdown, Entrance stagger disabled under prefers-reduced-motion.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Layers } from 'lucide-react'

import { EmptyState, ErrorState } from '@/components/layout/states'
import { FilterProvider, useFilters, type ActiveFilters } from '@/lib/filter-context'
import { useLatest } from '@/lib/data'
import { useSegments, type SegmentId, type SegmentsResult } from '@/lib/segments'
import { usePrivacy } from '@/lib/privacy'
import { type TransientDossier } from '@/lib/workspaces'
import { cn } from '@/lib/utils'

import { SegmentCard } from './SegmentCard'
import { SegmentReconcileBar } from './SegmentReconcileBar'
import { SegmentBreakdown } from './SegmentBreakdown'

/* ------------------------------------------------------------------ */
/* Entrance stagger (motion-spec §1 — Journey pattern: fade + 6px rise, */
/* 300ms, 60ms apart; prefers-reduced-motion renders statically)        */
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
/* Filter semantics (§4.2)                                             */
/* ------------------------------------------------------------------ */

const EMPTY = (): ActiveFilters => ({
  geography: new Set(),
  platform: new Set(),
  sector: new Set(),
  assetClass: new Set(),
})

/** The exact filter set a segment card click writes (replace-all). */
function filtersForSegment(id: SegmentId): ActiveFilters {
  if (id === 'us') return { ...EMPTY(), geography: new Set(['US']) }
  if (id === 'india') return { ...EMPTY(), geography: new Set(['IN']) }
  if (id === 'cas') return { ...EMPTY(), platform: new Set(['groww', 'sharekhan']) }
  return EMPTY()
}

/** True only for the EXACT filter set the segment's card click produces
 *  (read-highlight, §1.2). Subsets/supersets ring nothing. */
function segmentFilterMatch(id: SegmentId, f: ActiveFilters): boolean {
  const none =
    f.geography.size === 0 && f.platform.size === 0 && f.sector.size === 0 && f.assetClass.size === 0
  if (id === 'consolidated') return none
  if (id === 'us' || id === 'india') {
    const expected = id === 'us' ? 'US' : 'IN'
    return (
      f.geography.size === 1 &&
      f.geography.has(expected) &&
      f.platform.size === 0 &&
      f.sector.size === 0 &&
      f.assetClass.size === 0
    )
  }
  return (
    f.platform.size === 2 &&
    f.platform.has('groww') &&
    f.platform.has('sharekhan') &&
    f.geography.size === 0 &&
    f.sector.size === 0 &&
    f.assetClass.size === 0
  )
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

interface SegmentsScreenProps {
  /** Holding-row select → HoldingDossier hop (setTransientDossier seam —
   *  the Partial<TransientDossier> shape matches the workspace hook). */
  setTransientDossier: (d: Partial<TransientDossier>) => void
}

export function SegmentsScreen({ setTransientDossier }: SegmentsScreenProps) {
  const segments = useSegments()
  const latest = useLatest()
  const { masked } = usePrivacy()
  const [selectedId, setSelectedId] = useState<SegmentId | null>(null)

  const holdings = latest.data?.holdings ?? []
  const isLoading = segments.isLoading || latest.isLoading
  const isError = segments.isError || latest.isError

  const data = segments.data

  const selectedSegment = useMemo(
    () => (selectedId && data ? (data.byId[selectedId] ?? null) : null),
    [selectedId, data],
  )

  const handleDossierSelect = (ticker: string) => {
    setTransientDossier({ ticker, previousWorkspace: 'portfolio' })
  }

  if (isLoading) return <SegmentsSkeleton />
  if (isError || !data) {
    return (
      <ErrorState
        message={segments.error ?? 'Segments could not be derived from the latest export.'}
      />
    )
  }
  if (holdings.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No holdings yet"
        description="Run a snapshot and export to see your four portfolio segments here."
      />
    )
  }

  // ONE provider wraps BOTH branches (grid + breakdown): the card click writes
  // the segment filter into this provider, the breakdown reads it back ("Clear
  // segment filter"), and Esc returns to the grid with filters still active —
  // the spec's §4 semantics. A provider per branch would reset that state on
  // every grid ⇄ breakdown hop.
  return (
    <FilterProvider holdings={holdings}>
      {selectedSegment ? (
        <SegmentBreakdown
          segment={selectedSegment}
          onBack={() => setSelectedId(null)}
          onDossierSelect={handleDossierSelect}
        />
      ) : (
        <SegmentsGrid
          data={data}
          masked={masked}
          onOpenCard={setSelectedId}
          accountPnlSgd={latest.data?.totals.dayPnlByAccountCurrency['SGD'] ?? null}
        />
      )}
    </FilterProvider>
  )
}

/* ------------------------------------------------------------------ */
/* Grid (the default view)                                             */
/* ------------------------------------------------------------------ */

function SegmentsGrid({
  data,
  masked,
  onOpenCard,
  accountPnlSgd,
}: {
  data: SegmentsResult
  masked: boolean
  onOpenCard: (id: SegmentId) => void
  accountPnlSgd: number | null
}) {
  const { activeFilters, replaceFilters, hasActiveFilters } = useFilters()
  const { segments: list, reconciliation } = data
  const featured = data.byId['consolidated']

  if (!featured) return null

  const openCard = (id: SegmentId) => {
    replaceFilters(filtersForSegment(id))
    onOpenCard(id)
  }

  // Live-region announcement: the two identity checks + count, final state
  // only. Plain const (string concat) — recompute is trivial; the sr-only
  // node re-announces on data identity change (a refresh). Identity 2 is
  // exact only when BOTH the raw-vs-derived sum AND the count agree.
  const announce =
    `Segments loaded. ${featured.holdings.length} holdings. ` +
    `Identity: US plus India equals consolidated — ${
      reconciliation.matches.usPlusIndiaEqConsolidated ? 'exact' : 'differs'
    }. Groww plus Sharekhan equals Groww-CAS — ${
      reconciliation.matches.casEqGrowwSharekhan &&
      reconciliation.matches.casCountEqGrowwSharekhan
        ? 'exact'
        : 'differs'
    }.`

  return (
    <div className="min-w-0 space-y-4">
      <h1 className="sr-only">Segments</h1>
      {/* Final-state announcement only (aria-live=polite; no chatter per keystroke) */}
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>

      {/* Featured: Consolidated hero */}
      <Entrance index={0}>
        <SegmentCard
          segment={featured}
          variant="featured"
          active={segmentFilterMatch(featured.id, activeFilters)}
          masked={masked}
          onOpen={() => openCard(featured.id)}
        />
      </Entrance>

      {/* The three component segments */}
       <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
        {(['us', 'india', 'cas'] as const).map((id, i) => {
          const seg = data.byId[id]
          if (!seg) return null
          return (
            <Entrance key={id} index={i + 1}>
              <SegmentCard
                segment={seg}
                active={segmentFilterMatch(id, activeFilters)}
                masked={masked}
                accountPnlSgd={id === 'us' ? accountPnlSgd : null}
                onOpen={() => openCard(id)}
              />
            </Entrance>
          )
        })}
      </div>

      {/* Cross-filters-active note: universe filtered to something no segment
       * rings (a sector, a platform mix…) — hint, never a correction. */}
      {hasActiveFilters && !list.some((s) => segmentFilterMatch(s.id, activeFilters)) && (
        <p className="text-xs text-muted-foreground">
          Filters are active in the universe but don&apos;t match a whole segment. Click a
          segment to replace them.
        </p>
      )}

      <Entrance index={4}>
        <SegmentReconcileBar segments={list} reconciliation={reconciliation} />
      </Entrance>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Skeleton (§8)                                                       */
/* ------------------------------------------------------------------ */

function SegmentsSkeleton() {
  return (
    <div className="min-w-0 space-y-4" role="status" aria-label="Loading segments…">
      <div className="h-28 rounded-lg border bg-card p-5">
        <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-7 w-44 animate-pulse rounded bg-muted" />
      </div>
       <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-40 rounded-lg border bg-card p-4">
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-6 w-32 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
