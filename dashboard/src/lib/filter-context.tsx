/**
 * src/lib/filter-context.tsx — Cross-filter state for the three-pane shell.
 *
 * The ContextRail AllocationLens donut clicks set filters here; UniversePane
 * reads them to filter the holdings list. Center-pane workspaces
 * (India/US/Returns) can opt in via useFilters() but are not required to.
 *
 * JourneyWorkspace is never filtered (per spec: "Journey is never filtered").
 *
 * Design: the provider takes the raw `holdings` array from useLatest() and
 * owns the filter state + derivation. Children consume via useFilters().
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'

import type { Holding } from '@/types/contract'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type FilterDimension = 'geography' | 'platform' | 'sector' | 'assetClass'

export interface ActiveFilters {
  geography: Set<string>
  platform: Set<string>
  sector: Set<string>
  assetClass: Set<string>
}

/** The value exposed by FilterContext — filter state + helpers + derived data. */
export interface FilterContextValue {
  activeFilters: ActiveFilters
  /** Toggle one value in a dimension. If it exists, remove it; otherwise add it. */
  toggleFilter: (dim: FilterDimension, value: string) => void
  /** Clear all active filters. */
  clearFilters: () => void
  /** Holdings filtered by the current activeFilters. Does NOT apply search. */
  filteredHoldings: Holding[]
  /** True when any filter dimension has at least one active value. */
  hasActiveFilters: boolean
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

const FilterContext = createContext<FilterContextValue | null>(null)

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

const EMPTY: ActiveFilters = {
  geography: new Set(),
  platform: new Set(),
  sector: new Set(),
  assetClass: new Set(),
}

export function FilterProvider({
  holdings,
  children,
}: {
  holdings: Holding[] | undefined
  children: ReactNode
}) {
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({
    ...EMPTY,
    geography: new Set(),
    platform: new Set(),
    sector: new Set(),
    assetClass: new Set(),
  })

  const toggleFilter = useCallback((dim: FilterDimension, value: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev[dim])
      if (next.has(value)) {
        next.delete(value)
      } else {
        next.add(value)
      }
      return { ...prev, [dim]: next }
    })
  }, [])

  const clearFilters = useCallback(() => {
    setActiveFilters({
      geography: new Set(),
      platform: new Set(),
      sector: new Set(),
      assetClass: new Set(),
    })
  }, [])

  const filteredHoldings = useMemo(() => {
    if (!holdings) return []
    return holdings.filter((h) => {
      if (activeFilters.geography.size > 0 && !activeFilters.geography.has(h.geography))
        return false
      if (activeFilters.platform.size > 0 && !activeFilters.platform.has(h.platform))
        return false
      if (
        activeFilters.sector.size > 0 &&
        h.sector !== null &&
        !activeFilters.sector.has(h.sector)
      )
        return false
      if (
        activeFilters.assetClass.size > 0 &&
        h.assetClass !== null &&
        !activeFilters.assetClass.has(h.assetClass)
      )
        return false
      return true
    })
  }, [holdings, activeFilters])

  const hasActiveFilters = useMemo(
    () =>
      activeFilters.geography.size > 0 ||
      activeFilters.platform.size > 0 ||
      activeFilters.sector.size > 0 ||
      activeFilters.assetClass.size > 0,
    [activeFilters],
  )

  const value = useMemo<FilterContextValue>(
    () => ({
      activeFilters,
      toggleFilter,
      clearFilters,
      filteredHoldings,
      hasActiveFilters,
    }),
    [activeFilters, toggleFilter, clearFilters, filteredHoldings, hasActiveFilters],
  )

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

/* ------------------------------------------------------------------ */
/* Consumer hook                                                       */
/* ------------------------------------------------------------------ */

export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext)
  if (!ctx) {
    throw new Error('useFilters must be used within a <FilterProvider>')
  }
  return ctx
}
