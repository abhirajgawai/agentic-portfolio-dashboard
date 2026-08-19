/**
 * Year strip — "2026 so far: ₹X → ₹Y (+Z%)" computed from the FIRST and LAST
 * ledger points of the current year in history.json.
 *
 * The year comes from the DATA (the last snapshot date), never a clock read —
 * deterministic, and honest: "so far" ends where the ledger ends. When the
 * year has fewer than two points, the strip says so instead of inventing a
 * percentage.
 */

import { useMemo } from 'react'
import { ArrowRight } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { formatInrCompact, formatPct, MASK_TEXT } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { cn } from '@/lib/utils'
import type { History } from '@/types/contract'

function yearWindow(history: History): {
  year: string | null
  first: number | null
  last: number | null
  pct: number | null
} {
  const lastDate = history.dates[history.dates.length - 1]
  if (!lastDate) return { year: null, first: null, last: null, pct: null }
  const year = lastDate.slice(0, 4)
  const indexes: number[] = []
  history.dates.forEach((date, index) => {
    if (date.startsWith(year)) indexes.push(index)
  })
  if (indexes.length < 2) return { year, first: null, last: null, pct: null }
  const firstIdx = indexes[0] ?? 0
  const lastIdx = indexes[indexes.length - 1] ?? 0
  const first = history.portfolioValueBase[firstIdx] ?? 0
  const last = history.portfolioValueBase[lastIdx] ?? 0
  const pct = first > 0 ? ((last - first) / first) * 100 : null
  return { year, first, last, pct }
}

export function YearStrip({ history }: { history: History }) {
  const { masked } = usePrivacy()
  const yearInfo = useMemo(() => yearWindow(history), [history])

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-center gap-2 p-3">
        {yearInfo.year && yearInfo.first !== null && yearInfo.last !== null ? (
          <>
            <span className="text-xs font-medium text-muted-foreground">
              {yearInfo.year} so far
            </span>
            <span className="text-xs tabular-nums">
              {masked ? MASK_TEXT : formatInrCompact(yearInfo.first)}
            </span>
            <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-semibold tabular-nums">
              {masked ? MASK_TEXT : formatInrCompact(yearInfo.last)}
            </span>
            {yearInfo.pct !== null && (
              <span
                className={cn(
                  'text-xs font-medium tabular-nums',
                  yearInfo.pct >= 0 ? 'text-gain' : 'text-loss',
                )}
              >
                {formatPct(yearInfo.pct)}
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            {yearInfo.year
              ? `Not enough history in ${yearInfo.year} yet`
              : 'History accumulates with each snapshot'}
          </span>
        )}
      </CardContent>
    </Card>
  )
}
