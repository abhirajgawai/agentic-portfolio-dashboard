/**
 * Generic holdings table (TanStack Table v8) — used by the India and US views.
 * Sorting + text search + empty states. All values come from the contract;
 * `valueField` picks valueBase (INR legs) or valueDisplay (moomoo SGD leg).
 *
 * Memoized with React.memo to prevent re-creating the table instance when
 * parent re-renders with the same holdings data. The table instance is
 * stabilized via useMemo — it only recreates when columns or data identity changes.
 */

import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, createColumnHelper } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from 'lucide-react'
import { useMemo, useState, memo } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/layout/states'
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
  displayCurrency: string
  /** Show the platform column (India has 3 platforms, US only moomoo). */
  platformVisible?: boolean
}

const HoldingsTableInner = memo(function HoldingsTableInner({
  holdings,
  displayCurrency,
  platformVisible = true,
}: HoldingsTableProps) {
  const [sorting, setSorting] = useState([{ id: 'value', desc: true }])
  const [search, setSearch] = useState('')
  const { masked } = usePrivacy()

  const columns = useMemo(
    () => [
      columnHelper.accessor('ticker', {
        header: 'Ticker',
        cell: (info) => (
          <span className="font-medium tabular-nums">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('name', {
        header: 'Name',
        cell: (info) => info.getValue() ?? '—',
      }),
      ...(platformVisible
        ? [
            columnHelper.accessor('platform', {
              header: 'Platform',
              cell: (info) => (
                <Badge variant="secondary" className="font-normal">
                  {platformLabel(info.getValue())}
                </Badge>
              ),
            }),
          ]
        : []),
      columnHelper.accessor('qty', {
        header: 'Qty',
        cell: (info) => (
          <span className="tabular-nums">{masked ? MASK_TEXT : formatQty(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor('avgPrice', {
        header: 'Avg price',
        cell: (info) =>
          info.getValue() === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums">{masked ? MASK_TEXT : formatPrice(info.getValue() as number)}</span>
          ),
      }),
      columnHelper.accessor('ltp', {
        header: 'LTP',
        cell: (info) => (
          <span className="tabular-nums">{masked ? MASK_TEXT : formatPrice(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor('valueBase', {
        id: 'value',
        header: () => `Value (${displayCurrency})`,
        cell: (info) => (
          <span className="font-medium tabular-nums">
            {masked ? MASK_TEXT : formatMoney(info.row.original.valueDisplay, displayCurrency)}
          </span>
        ),
        sortingFn: (a, b) => a.original.valueDisplay - b.original.valueDisplay,
      }),
      columnHelper.accessor('dayChangePct', {
        header: 'Day %',
        cell: (info) => <PctCell value={info.getValue()} />,
        sortDescFirst: true,
      }),
      columnHelper.accessor('returnPct', {
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
      }),
    ],
    [displayCurrency, masked, platformVisible],
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

  if (holdings.length === 0) {
    return (
      <EmptyState
        title="No holdings on this leg"
        description="The pipeline has not captured positions for this geography yet."
      />
    )
  }

  const rows = table.getRowModel().rows

  return (
    <Card className="overflow-hidden">
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
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b bg-muted/40">
                {hg.headers.map((header) => {
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'px-3 py-2 text-xs font-medium text-muted-foreground',
                        header.column.getCanSort() ? 'cursor-pointer select-none hover:text-foreground' : '',
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <span className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() &&
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
          <tbody>
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
              rows.map((row) => (
                <tr
                  key={`${row.original.platform}:${row.original.ticker}:${row.id}`}
                  className="border-b border-border/50 transition-colors last:border-0 hover:bg-accent/40"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
})

HoldingsTableInner.displayName = 'HoldingsTable'

export const HoldingsTable = HoldingsTableInner