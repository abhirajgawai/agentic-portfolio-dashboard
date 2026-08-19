/**
 * src/components/shell/UniversePane.tsx — Left pane (256px, collapsible).
 * - Header: "Holdings" + count + collapse toggle.
 * - Search input (filters by ticker/name/platform).
 * - FilterBar pills: geography + asset class toggles (via FilterContext).
 * - HoldingsTable (sidebar variant) with row selection → onSelect(ticker).
 * - Collapse state managed by AppShell via `.collapsed` class on wrapper.
 *
 * Filter state is lifted to FilterContext (AppShell). The local search is
 * applied on top of the cross-filtered holdings from the context.
 *
 * Mobile (< 768px): renders as a full-screen slide-in overlay when isOpen=true,
 * with backdrop + close button. Desktop: renders as a flex child (no overlay).
 */

import { useState, useMemo, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { HoldingsTable } from '@/components/holdings/HoldingsTable'
import { useFilters } from '@/lib/filter-context'
import { assetClassLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/use-media-query'

interface UniversePaneProps {
  onSelect?: (ticker: string) => void
  /** Whether the pane is collapsed (managed by AppShell) */
  isCollapsed?: boolean
  /** Toggle collapse callback */
  onToggleCollapse?: () => void
  /** Mobile overlay open state (ignored on desktop) */
  isOpen?: boolean
  /** Called when the mobile overlay should close */
  onClose?: () => void
}

/** Pill definition for FilterBar toggles. */
interface FilterPill {
  value: string
  label: string
  dimension: 'geography' | 'assetClass'
}

export function UniversePane({ onSelect, isCollapsed, onToggleCollapse, isOpen = true, onClose }: UniversePaneProps) {
  const isMobile = useMediaQuery('(max-width: 767px)')
  const [search, setSearch] = useState('')
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const { filteredHoldings, activeFilters, toggleFilter } = useFilters()

  // Ref for the search input — keyboard shortcut / focuses it.
  const searchRef = useRef<HTMLInputElement>(null)

  // Global keyboard shortcuts for search focus and clear.
  // / focuses search (when not already in an input/textarea).
  // Escape clears search and returns focus to the table.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // / focuses search — matches Linear/Vercel convention (section 2.1.6)
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      // Escape clears search and blurs the input
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setSearch('')
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Derive unique geographies and asset classes from the cross-filtered
  // holdings so pills reflect what's available after other filters.
  const uniqueGeographies = useMemo(() => {
    return [...new Set(filteredHoldings.map((h) => h.geography))].sort()
  }, [filteredHoldings])

  const uniqueAssetClasses = useMemo(() => {
    return [...new Set(filteredHoldings.map((h) => h.assetClass).filter(Boolean) as string[])].sort()
  }, [filteredHoldings])

  // Build filter pills
  const pills: FilterPill[] = useMemo(() => {
    const geoPills = uniqueGeographies.map((g) => ({
      value: g,
      label: g,
      dimension: 'geography' as const,
    }))
    const acPills = uniqueAssetClasses.map((ac) => ({
      value: ac,
      label: assetClassLabel(ac),
      dimension: 'assetClass' as const,
    }))
    return [...geoPills, ...acPills]
  }, [uniqueGeographies, uniqueAssetClasses])

  // Apply local search on top of the cross-filtered holdings
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return filteredHoldings

    return filteredHoldings.filter((h) => {
      return (
        h.ticker.toLowerCase().includes(q) ||
        (h.name ?? '').toLowerCase().includes(q) ||
        h.platform.toLowerCase().includes(q)
      )
    })
  }, [filteredHoldings, search])

  // ---- Mobile overlay: slide-in from left ----
  if (isMobile && isOpen) {
    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50 z-modal"
          onClick={onClose}
          aria-hidden="true"
        />
        {/* Panel */}
        <div className="fixed inset-y-0 left-0 z-modal w-64 bg-sidebar border-r border-border flex flex-col transform transition-transform duration-250 ease-out">
          {/* Header: title + close */}
          <div className="flex items-center justify-between h-10 px-3 border-b border-border">
            <h2 className="text-xs font-semibold text-foreground">Holdings</h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {filtered.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="size-3.5" />
            </Button>
          </div>

          {/* Search input */}
          <div className="px-3 py-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="h-7 pl-6 pr-2 text-sm border-border/50 focus:ring-1 focus:ring-ring"
                aria-label="Search holdings"
              />
            </div>
          </div>

          {/* FilterBar pills */}
          {pills.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 py-1">
              {pills.map((pill) => (
                <button
                  key={pill.value}
                  type="button"
                  aria-pressed={activeFilters[pill.dimension].has(pill.value)}
                  onClick={() => toggleFilter(pill.dimension, pill.value)}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-medium border border-border/50 transition-colors',
                    activeFilters[pill.dimension].has(pill.value)
                      ? 'bg-primary/10 text-primary border-primary/30'
                      : 'text-muted-foreground hover:text-foreground hover:border-border',
                  )}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          )}

          {/* Table */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <HoldingsTable
              variant="sidebar"
              hideHeader
              holdings={filtered}
              onSelect={onSelect}
              selectedTicker={selectedTicker}
              selectedTickerSet={setSelectedTicker}
            />
          </div>
        </div>
      </>
    )
  }

  // ---- Desktop: render as a flex child (no overlay) ----
  return (
    <div
      className="flex flex-col h-full w-64 shrink-0 bg-sidebar border-r border-border"
      role="navigation"
      aria-label="Holdings universe"
    >
      {/* Header: h-10, title + count + collapse */}
      <div className="flex items-center justify-between h-10 px-3 border-b border-border">
        <h2 className="text-xs font-semibold text-foreground">Holdings</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {filtered.length}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={isCollapsed ? 'Expand sidebar (Ctrl+[)' : 'Collapse sidebar (Ctrl+[)'}
          title={isCollapsed ? 'Expand sidebar (Ctrl+[)' : 'Collapse sidebar (Ctrl+[)'}
          onClick={onToggleCollapse}
        >
          {isCollapsed
            ? <ChevronRight className="size-3.5" />
            : <ChevronLeft className="size-3.5" />}
        </Button>
      </div>

      {/* Search input */}
      <div className="px-3 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search… (press /)"
            className="h-7 pl-6 pr-2 text-sm border-border/50 focus:ring-1 focus:ring-ring"
            aria-label="Search holdings"
          />
        </div>
      </div>

      {/* FilterBar pills */}
      {pills.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 py-1">
          {pills.map((pill) => (
            <button
              key={pill.value}
              type="button"
              aria-pressed={activeFilters[pill.dimension].has(pill.value)}
              onClick={() => toggleFilter(pill.dimension, pill.value)}
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-medium border border-border/50 transition-colors',
                activeFilters[pill.dimension].has(pill.value)
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:border-border',
              )}
            >
              {pill.label}
            </button>
          ))}
        </div>
      )}

      {/* Table (HoldingsTable in sidebar mode) */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <HoldingsTable
          variant="sidebar"
          hideHeader
          holdings={filtered}
          onSelect={onSelect}
          selectedTicker={selectedTicker}
          selectedTickerSet={setSelectedTicker}
        />
      </div>
    </div>
  )
}
