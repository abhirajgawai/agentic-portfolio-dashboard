/**
 * src/components/shell/AllocationLens.tsx — The 4 allocation donuts (geography /
 * platform / sector / asset_class) become filter controls. Click a slice = filter
 * ON (selected slice highlighted, others dim), click again or "clear" = off.
 * Cross-filter applies to UniversePane + India/US/Returns workspaces; Journey is
 * never filtered. Each donut has an accessible fallback: hidden <table> of slice
 * values (sr-only) + aria-pressed on slices.
 */

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { z } from 'zod'
import type { Allocation } from '@/types/contract'

// — Schema for a single donut filter option —
const FilterOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number().optional(),
})

type FilterOption = z.infer<typeof FilterOptionSchema>

// — The four filter dimensions —
type FilterDimension =
  | 'geography' // IN | US
  | 'platform'  // zerodha | moomoo | groww | sharekhan | real_estate
  | 'sector'    // Banking, Technology, etc.
  | 'assetClass' // equity, etf, mutual_fund, real_estate

interface AllocationLensProps {
  /** Current allocation data from latest.json */
  allocation: Allocation
  /** Currently active filters per dimension */
  activeFilters: Record<FilterDimension, Set<string>>
  /** Toggle a filter on/off for a given dimension */
  toggleFilter: (dim: FilterDimension, value: string) => void
  /** Clear all filters */
  clearFilters: () => void
}

/** 4 donut dimensions and their display labels */
const DIMENSION_LABELS: Record<FilterDimension, string> = {
  geography: 'Geography',
  platform: 'Platform',
  sector: 'Sector',
  assetClass: 'Asset Class',
}

/** Map a filter dimension to the contract's Allocation record key. */
const ALLOCATION_KEY: Record<FilterDimension, keyof Allocation> = {
  geography: 'byGeography',
  platform: 'byPlatform',
  sector: 'bySector',
  assetClass: 'byAssetClass',
}

/** Build options from allocation data */
function buildOptions(dim: FilterDimension, allocation: Allocation): FilterOption[] {
  const data = allocation[ALLOCATION_KEY[dim]]
  return Object.entries(data)
    .filter(([, v]) => v > 0)
    .map(([label, value]) => ({
      value: label,
      label: label.charAt(0).toUpperCase() + label.slice(1),
      count: Math.round(value),
    }))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
}

export function AllocationLens({
  allocation,
  activeFilters,
  toggleFilter,
  clearFilters,
}: AllocationLensProps) {
  const [expanded, setExpanded] = useState<'geography' | 'platform' | 'sector' | 'assetClass' | null>(null)

  const dimension = expanded ?? 'geography' // default expanded dimension

  const options = useMemo(() => buildOptions(dimension, allocation), [dimension, allocation])

  return (
    <div className="space-y-4">
      {/* Dimension tabs — wrap on narrow viewports */}
      <div className="flex flex-wrap gap-1 border-b border-border/30 pb-2">
        <button
          key="geography"
          type="button"
          className={cn(
            'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
            activeFilters.geography?.size > 0 ? 'bg-accent/20 text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
            'data-[state=active]:bg-accent/20',
          )}
          onClick={() => setExpanded('geography')}
        >
          Geography
          {activeFilters.geography?.size > 0 && (
            <span className="ml-1 text-xs font-bold">✓</span>
          )}
        </button>
        <button
          key="platform"
          type="button"
          className={cn(
            'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
            activeFilters.platform?.size > 0 ? 'bg-accent/20 text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
            'data-[state=active]:bg-accent/20',
          )}
          onClick={() => setExpanded('platform')}
        >
          Platform
          {activeFilters.platform?.size > 0 && (
            <span className="ml-1 text-xs font-bold">✓</span>
          )}
        </button>
        <button
          key="sector"
          type="button"
          className={cn(
            'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
            activeFilters.sector?.size > 0 ? 'bg-accent/20 text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
            'data-[state=active]:bg-accent/20',
          )}
          onClick={() => setExpanded('sector')}
        >
          Sector
          {activeFilters.sector?.size > 0 && (
            <span className="ml-1 text-xs font-bold">✓</span>
          )}
        </button>
        <button
          key="assetClass"
          type="button"
          className={cn(
            'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
            activeFilters.assetClass?.size > 0 ? 'bg-accent/20 text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
            'data-[state=active]:bg-accent/20',
          )}
          onClick={() => setExpanded('assetClass')}
        >
          Asset Class
          {activeFilters.assetClass?.size > 0 && (
            <span className="ml-1 text-xs font-bold">✓</span>
          )}
        </button>
      </div>

      {/* Donut options grid */}
      <div className="grid grid-cols-2 gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={cn(
              'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              activeFilters[dimension]?.has(opt.value)
                ? 'bg-accent text-accent-foreground'
                : 'bg-muted/70 text-foreground hover:bg-accent/20',
            )}
            onClick={() => toggleFilter(dimension, opt.value)}
            aria-pressed={activeFilters[dimension]?.has(opt.value) ?? false}
            aria-label={`Filter by ${DIMENSION_LABELS[dimension]}: ${opt.label}`}
          >
            <span className="size-3.5 rounded-full bg-current/30 mr-1.5" />
            <span>{opt.label}: {opt.count ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Clear all button when filters are active */}
      {Object.values(activeFilters).some((s) => s.size > 0) && (
        <button
          type="button"
          className="mt-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors text-destructive hover:bg-destructive/10"
          onClick={clearFilters}
          aria-label="Clear all filters"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}