/**
 * Account roads — per-platform stat rows (redesigned from tiny area
 * sparklines, which had almost no pixels to draw a trend in with only a
 * few days of history and were never labeled anyway).
 *
 * Hierarchy flipped per the same "Option A" principle as JourneyChart: the
 * number leads, the sparkline shrinks to a small decoration alongside a
 * labeled day-over-day delta chip — readable at 2 data points or 200.
 *
 * Data source: history.byPlatform (the ledger's per-platform base-INR
 * series) — the only per-platform time series the contract carries; a
 * finer Groww MF vs Groww Equities split (available point-in-time on the
 * Portfolio tab via asset class) has no historical series to draw a trend
 * from, so this stays platform-level.
 */

import { useMemo } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

import { formatInrCompact, MASK_TEXT, platformLabel } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { History } from '@/types/contract'

const PLATFORM_COLORS: Record<string, string> = {
  zerodha: 'var(--chart-1)',
  moomoo: 'var(--chart-2)',
  groww: 'var(--chart-3)',
  sharekhan: 'var(--chart-4)',
  real_estate: 'var(--chart-5)',
}

interface RoadRow {
  platform: string
  values: number[]
  current: number
  delta: number
  deltaPct: number | null
}

/** Trim leading/trailing non-running (zero) days, then compute current value
 *  + the latest day-over-day delta. */
function buildRow(platform: string, all: number[]): RoadRow | null {
  const start = all.findIndex((v) => v > 0)
  if (start === -1) return null
  let end = all.length - 1
  while (end > start && (all[end] ?? 0) === 0) end -= 1
  const values = all.slice(start, end + 1)
  const current = values[values.length - 1] ?? 0
  const prev = values.length >= 2 ? (values[values.length - 2] ?? current) : current
  const delta = current - prev
  const deltaPct = prev !== 0 ? (delta / prev) * 100 : null
  return { platform, values, current, delta, deltaPct }
}

function MiniSpark({ values, color }: { values: number[]; color: string }) {
  const width = 64
  const height = 24
  if (values.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
        <line x1={2} y1={height / 2} x2={width - 2} y2={height / 2} stroke={color} strokeWidth={2} strokeDasharray="2 3" opacity={0.5} />
      </svg>
    )
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values
    .map((v, i) => {
      const x = 2 + (i / (values.length - 1)) * (width - 4)
      const y = height - 2 - ((v - min) / span) * (height - 4)
      return `${x},${y}`
    })
    .join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RoadRowItem({ row }: { row: RoadRow }) {
  const { masked } = usePrivacy()
  const color = PLATFORM_COLORS[row.platform] ?? 'var(--chart-1)'
  const Icon = row.delta > 0 ? TrendingUp : row.delta < 0 ? TrendingDown : Minus
  const deltaClass = row.delta > 0 ? 'text-gain' : row.delta < 0 ? 'text-loss' : 'text-muted-foreground'

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0">
      <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-sm font-medium min-w-0 flex-1 truncate">{platformLabel(row.platform)}</span>
      <MiniSpark values={row.values} color={color} />
      <span className="text-sm font-semibold tabular-nums text-right min-w-[92px]">
        {masked ? MASK_TEXT : formatInrCompact(row.current)}
      </span>
      <span className={cn('flex items-center gap-1 text-xs font-medium tabular-nums justify-end min-w-[84px]', deltaClass)}>
        <Icon className="size-3 shrink-0" />
        {masked
          ? MASK_TEXT
          : row.delta === 0
            ? '—'
            : `${row.delta > 0 ? '+' : ''}${formatInrCompact(row.delta)}`}
      </span>
    </div>
  )
}

interface AccountRoadsProps {
  history: History
  /** `condensed` (Journey's right-rail snapshot, max 4 rows) vs `full` (Allocation's
   *  first-class section, every row, no truncation) — same rows/logic, presentation only. */
  variant?: 'condensed' | 'full'
}

const CONDENSED_ROW_LIMIT = 4

export function AccountRoads({ history, variant = 'full' }: AccountRoadsProps) {
  const rows = useMemo(() => {
    return Object.entries(history.byPlatform)
      .filter(([platform]) => platform !== 'real_estate')
      .map(([platform, values]) => buildRow(platform, values))
      .filter((r): r is RoadRow => r !== null && r.current > 0)
      .sort((a, b) => b.current - a.current)
  }, [history])

  const visibleRows = variant === 'condensed' ? rows.slice(0, CONDENSED_ROW_LIMIT) : rows
  const hiddenCount = rows.length - visibleRows.length

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold">Account roads</h3>
        <p className="text-[11px] text-muted-foreground mb-1">
          Platform value + latest day-over-day change (base INR)
        </p>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No platform data yet</p>
        ) : (
          <div>
            {visibleRows.map((row) => (
              <RoadRowItem key={row.platform} row={row} />
            ))}
          </div>
        )}
        {hiddenCount > 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            +{hiddenCount} more on Allocation
          </p>
        )}
      </CardContent>
    </Card>
  )
}
