/**
 * src/components/filters/FilterBar.tsx — Slim geography + asset-class filter
 * pills for the Universe pane and the India/US workspaces. Controlled component:
 * the parent owns the filter state and passes it back via `onChange(filters)`.
 *
 * Contract:
 *   <FilterBar filters={filters} onChange={onChange} />
 *
 * `filters` is an array of the active filter keys; a pill toggles itself. All
 * pills carry `aria-pressed` (a11y) and the widget exposes `aria-label`. This
 * component is deliberately dumb — it knows nothing about holdings, only the
 * pill list the parent supplies.
 */

import { useMemo } from 'react'

import { cn } from '@/lib/utils'

export type FilterKey = 'in' | 'us' | 'etf' | 'mutual_fund' | 'stock' | 'real_estate' | string

export interface FilterOption {
  key: FilterKey
  label: string
}

export interface FilterBarProps {
  /** Active filter keys. */
  filters?: FilterKey[]
  /** Called with the NEW active set after a pill toggles. */
  onChange?: (filters: FilterKey[]) => void
  /** Pills to render (default: a standard IN/US geography set). */
  options?: FilterOption[]
  /** Optional section heading (hidden when empty). */
  label?: string
  /** Radix/shadcn "sm"/"lg" sizing or a custom class for the pill row. */
  className?: string
}

const DEFAULT_OPTIONS: FilterOption[] = [
  { key: 'in', label: 'India' },
  { key: 'us', label: 'US' },
  { key: 'etf', label: 'ETF' },
  { key: 'mutual_fund', label: 'Mutual Fund' },
  { key: 'stock', label: 'Stock' },
]

export function FilterBar({
  filters = [],
  onChange,
  options = DEFAULT_OPTIONS,
  label,
  className,
}: FilterBarProps) {
  const active = useMemo(() => new Set(filters), [filters])

  const toggle = (key: FilterKey) => {
    if (!onChange) return
    const next = new Set(active)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    onChange([...next])
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)} role="group" aria-label={label ?? 'Filters'}>
      {options.map((opt) => {
        const isActive = active.has(opt.key)
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => toggle(opt.key)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
