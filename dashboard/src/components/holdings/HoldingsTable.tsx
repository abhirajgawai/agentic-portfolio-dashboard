/**
 * Generic holdings table (TanStack Table v8) — used by the India and US views
 * and the Universe pane's row selection. Sorting + text search + empty states.
 * All values come from the contract; value is shown in the leg's display
 * currency (INR for India, SGD for moomoo).
 *
 * Upgrades (backward-compatible):
 *   - `onSelect` / `selectedTicker` / `selectedTickerSet` are OPTIONAL. When
 *     absent the table renders exactly as before (IndiaView/USView unchanged).
 *     When present, rows become clickable, get `aria-selected` + a highlight,
 *     and arrow-key (↑/↓) navigation moves the selection.
 *   - Keyboard-sortable headers (`aria-sort`, Enter/Space toggles sort).
 *   - In-row platform-trend sparkline column when `showSparkline` is on.
 *   - Sticky header within the scroll container.
 *
 * Memoized with React.memo to prevent re-creating the table instance when
 * parent re-renders with the same holdings data. The table instance is
 * stabilized via useMemo — it only recreates when columns or data identity changes.
 */

import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, createColumnHelper } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from 'lucide-react'
import { useMemo, useState, memo, useRef, useEffect } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/layout/states'
import { EChart } from '@/components/charts/EChart'
import { buildSparklineOption } from '@/lib/sparkline'
import { useHistory } from '@/lib/data'
import { formatMoney, formatPct, formatPrice, formatQty, MASK_TEXT, platformLabel } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import type { Holding } from '@/types/contract'
import { cn } from '@/lib/utils'

const columnHelper = createColumnHelper<Holding>()

function PctCell({ value, align = 'right' }: { value: number | null; align?: 'right' | 'left' }) {
  if (value === null) return <span className="text-muted-foreground">—</span>
  const cls = value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : 'text-muted-foreground'
  return <span className={cn('tabular-nums', cls, align === 'right' ? 'text-right' : '')}>{formatPct(value)}</span>
}

interface HoldingsTableProps {
  holdings: Holding[]
  displayCurrency?: string
  /** Show the platform column (India has 3 platforms, US only moomoo). */
  platformVisible?: boolean
  /** Optional selection (Universe pane). When absent rows are not clickable. */
  onSelect?: (ticker: string) => void
  selectedTicker?: string | null
  selectedTickerSet?: (ticker: string | null) => void
  /** Show the in-row platform-trend sparkline column (default false). */
  showSparkline?: boolean
  /** Mixed-currency segments (e.g. Segments > Consolidated): render each row's
   *  value in the HOLDING's own displayCurrency (SGD for moomoo, INR for the
   *  INR legs) and label the column generically. When false (default), the
   *  single `displayCurrency` prop labels and formats every row — the existing
   *  behavior. */
  perRowCurrency?: boolean
  /** Sidebar variant: compact rows, ticker+badge, name, value only. */
  variant?: 'default' | 'sidebar'
  /** Suppress the built-in header (count + search). Used when the parent provides its own. */
  hideHeader?: boolean
  className?: string
}

const HoldingsTableInner = memo(function HoldingsTableInner({
  holdings,
  displayCurrency = 'INR',
  platformVisible = true,
  onSelect,
  selectedTicker = null,
  selectedTickerSet,
  showSparkline = false,
  variant = 'default',
  hideHeader = false,
  perRowCurrency = false,
  className,
}: HoldingsTableProps) {
  const isSidebar = variant === 'sidebar'
  const [sorting, setSorting] = useState([{ id: 'value', desc: true }])
  const [search, setSearch] = useState('')
  const { masked } = usePrivacy()
  const history = useHistory()
  const tbodyRef = useRef<HTMLTableSectionElement>(null)
  const selectable = typeof onSelect === 'function'

  // Sidebar variant suppresses sparklines regardless of prop
  const effectiveShowSparkline = isSidebar ? false : showSparkline

  // Sparkline options per platform. Depends on the unique platforms in the data,
  // NOT the holdings array identity (which would recreate on every parent render).
  // The contract has no per-holding history, so this is the platform trend,
  // honestly labeled by the column header ("Trend").
  const sparklineOptions = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildSparklineOption>>()
    if (!effectiveShowSparkline) return map
    const byPlatform = history.data?.byPlatform ?? {}
    const platforms = new Set(holdings.map((h) => h.platform))
    for (const platform of platforms) {
      map.set(platform, buildSparklineOption(platform, byPlatform))
    }
    return map
  }, [effectiveShowSparkline, history.data])

  const columns = useMemo(
    () => {
      const platformBadge = (platform: string) => (
        <span
          className={cn(
            'ml-1.5 inline-block rounded px-1 py-0.5 text-[10px] font-medium leading-none',
            platform === 'zerodha' && 'bg-blue-500/15 text-blue-400',
            platform === 'moomoo' && 'bg-purple-500/15 text-purple-400',
            platform === 'groww' && 'bg-emerald-500/15 text-emerald-400',
            platform === 'sharekhan' && 'bg-orange-500/15 text-orange-400',
            platform === 'real_estate' && 'bg-amber-500/15 text-amber-400',
          )}
        >
          {platformLabel(platform)}
        </span>
      )

      const tickerCol = columnHelper.accessor('ticker', {
        header: 'Ticker',
        cell: (info) => (
          <span className="font-medium tabular-nums">
            {info.getValue()}
            {isSidebar && platformBadge(info.row.original.platform)}
          </span>
        ),
      })

      const nameCol = columnHelper.accessor('name', {
        header: 'Name',
        cell: (info) => info.getValue() ?? '—',
      })

      const platformCol = columnHelper.accessor('platform', {
        header: 'Platform',
        cell: (info) => (
          <Badge variant="secondary" className="font-normal">
            {platformLabel(info.getValue())}
          </Badge>
        ),
      })

      const qtyCol = columnHelper.accessor('qty', {
        header: 'Qty',
        cell: (info) => (
          <span className="tabular-nums">{masked ? MASK_TEXT : formatQty(info.getValue())}</span>
        ),
      })

      const avgPriceCol = columnHelper.accessor('avgPrice', {
        header: 'Avg price',
        cell: (info) =>
          info.getValue() === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums">{masked ? MASK_TEXT : formatPrice(info.getValue() as number)}</span>
          ),
      })

      const ltpCol = columnHelper.accessor('ltp', {
        header: 'LTP',
        cell: (info) => (
          <span className="tabular-nums">{masked ? MASK_TEXT : formatPrice(info.getValue())}</span>
        ),
      })

      const valueCol = columnHelper.accessor('valueBase', {
        id: 'value',
        header: () => (perRowCurrency ? 'Value' : `Value (${displayCurrency})`),
        cell: (info) => (
          <span className="font-medium tabular-nums">
            {masked
              ? MASK_TEXT
              : formatMoney(
                  info.row.original.valueDisplay,
                  perRowCurrency ? info.row.original.displayCurrency : displayCurrency,
                )}
          </span>
        ),
        sortingFn: (a, b) => a.original.valueDisplay - b.original.valueDisplay,
      })

      const dayChangeCol = columnHelper.accessor('dayChangePct', {
        header: 'Day %',
        cell: (info) => <PctCell value={info.getValue()} />,
        sortDescFirst: true,
      })

      // sparklineCol accesses sparklineOptions via CLOSURE (not dep) so the
      // columns array stays stable when sparklineOptions Map identity changes.
      const sparklineCol = columnHelper.display({
        id: 'sparkline',
        header: 'Trend',
        enableSorting: false,
        cell: (info) => {
          const option = sparklineOptions.get(info.row.original.platform)
          return option ? <EChart option={option} height={24} /> : <span className="text-muted-foreground">—</span>
        },
      })

      const returnCol = columnHelper.accessor('returnPct', {
        header: 'Return %',
        cell: (info) => <PctCell value={info.getValue()} />,
        sortDescFirst: true,
        sortingFn: (a, b) => {
          const va = a.original.returnPct
          const vb = b.original.returnPct
          if (va === null && vb === null) return 0
          if (va === null) return 1 // nulls sink regardless of direction
          if (vb === null) return -1
          return va - vb
        },
      })

      if (isSidebar) {
        // Sidebar: ticker (with badge), name, value — hide everything else
        return [tickerCol, nameCol, valueCol]
      }

      // Default: full column set
      return [
        tickerCol,
        nameCol,
        ...(platformVisible ? [platformCol] : []),
        qtyCol,
        avgPriceCol,
        ltpCol,
        valueCol,
        dayChangeCol,
        ...(effectiveShowSparkline ? [sparklineCol] : []),
        returnCol,
      ]
    },
    [displayCurrency, masked, platformVisible, effectiveShowSparkline, isSidebar, perRowCurrency],
  )

  // Stable data reference — only recreate when holdings array content changes
  const stableData = useMemo(() => holdings, [holdings])

  const table = useReactTable({
    data: stableData,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, value: string) => {
      const h = row.original
      const q = value.toLowerCase()
      return (
        h.ticker.toLowerCase().includes(q) ||
        (h.name ?? '').toLowerCase().includes(q) ||
        h.platform.toLowerCase().includes(q)
      )
    },
  })

  const rows = table.getRowModel().rows

  // Arrow-key row navigation (↑/↓) when selection is enabled. Focus stays on the
  // selected row; Home/End jump to the first/last row. All keys are guarded to
  // ignore input fields (the search box above). Declared BEFORE any conditional
  // return so the hook order never changes (Rules of Hooks).
  useEffect(() => {
    if (!selectable) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
      if (rows.length === 0) return
      const currentIdx = selectedTicker ? rows.findIndex((r) => r.original.ticker === selectedTicker) : -1
      let nextIdx: number
      if (e.key === 'ArrowDown') nextIdx = currentIdx + 1
      else if (e.key === 'ArrowUp') nextIdx = currentIdx - 1
      else if (e.key === 'Home') nextIdx = 0
      else nextIdx = rows.length - 1
      if (nextIdx < 0 || nextIdx >= rows.length) return
      e.preventDefault()
      const ticker = rows[nextIdx]?.original.ticker
      if (ticker) {
        selectedTickerSet?.(ticker)
        onSelect?.(ticker)
        const rowEl = tbodyRef.current?.querySelector<HTMLElement>(`[data-ticker="${CSS.escape(ticker)}"]`)
        rowEl?.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectable, rows, selectedTicker, onSelect, selectedTickerSet])

  if (holdings.length === 0) {
    return (
      <EmptyState
        title="No holdings on this leg"
        description="The pipeline has not captured positions for this geography yet."
      />
    )
  }

  return (
    <Card
      className={cn('overflow-hidden', isSidebar && '[--row-height:2rem]', className)}
      style={isSidebar ? { '--row-height': '2rem' } as React.CSSProperties : undefined}
    >
      {!hideHeader && (
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {rows.length} holding{rows.length === 1 ? '' : 's'}
          </span>
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ticker / name / platform…"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>
      )}
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b bg-muted/90 backdrop-blur">
                {hg.headers.map((header) => {
                  const sorted = header.column.getIsSorted()
                  const canSort = header.column.getCanSort()
                  const ariaSort = canSort ? (sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none') : undefined
                  return (
                    <th
                      key={header.id}
                      aria-sort={ariaSort}
                      className={cn(
                        'px-3 py-2 text-xs font-medium text-muted-foreground',
                        canSort ? 'cursor-pointer select-none hover:text-foreground' : '',
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                      onKeyDown={(e) => {
                        if (canSort && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault()
                          header.column.toggleSorting()
                        }
                      }}
                      tabIndex={canSort ? 0 : undefined}
                    >
                      <span className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort &&
                          (sorted === 'asc' ? (
                            <ArrowUp className="size-3" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ChevronsUpDown className="size-3 text-muted-foreground/50" />
                          ))}
                      </span>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody ref={tbodyRef}>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-xs text-muted-foreground"
                >
                  No holdings match “{search}”
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isSelected = selectable && selectedTicker === row.original.ticker
                return (
                  <tr
                    key={`${row.original.platform}:${row.original.ticker}:${row.id}`}
                    data-ticker={row.original.ticker}
                    data-selected={isSelected ? 'true' : undefined}
                    aria-selected={isSelected}
                    tabIndex={selectable && isSelected ? 0 : -1}
                    onClick={
                      selectable
                        ? () => {
                            selectedTickerSet?.(row.original.ticker)
                            onSelect?.(row.original.ticker)
                          }
                        : undefined
                    }
                    onKeyDown={
                      selectable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              selectedTickerSet?.(row.original.ticker)
                              onSelect?.(row.original.ticker)
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      'border-b border-border/50 transition-colors last:border-0 hover:bg-accent/40',
                      isSelected && 'bg-accent/40',
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn(
                          'px-3 align-middle',
                          isSidebar ? 'py-1' : 'py-2',
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
})

HoldingsTableInner.displayName = 'HoldingsTable'

export const HoldingsTable = HoldingsTableInner