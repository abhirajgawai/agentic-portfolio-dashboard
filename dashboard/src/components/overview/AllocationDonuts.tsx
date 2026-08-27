/** Three allocation breakdowns — geography, platform, asset class — as
 *  segmented horizontal bars, not pie/donut charts.
 *
 *  Part-to-whole is a bar job, not a pie job: comparing two slice ANGLES is
 *  much harder than comparing two bar LENGTHS, and a pie has nowhere to put
 *  a direct number without a separate legend anyway — so this skips straight
 *  to what the legend was already doing (one segmented bar for the shape of
 *  the whole, a labeled list for the exact numbers) instead of carrying a
 *  pie the reader has to cross-reference against it.
 *
 *  Every dimension sums to ~100% by construction (normalize/allocation.py).
 *  Category color is assigned by FIXED order (index -> --chart-N), never by
 *  value rank, so the same platform keeps the same color across renders.
 */

import { platformLabel } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { Allocation } from '@/types/contract'

type NameValue = { name: string; value: number }

/** Raw allocation record -> { name, value } sorted by value desc (today's order). */
function toNameValue(record: Record<string, number> | undefined): NameValue[] {
  return Object.entries(record ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }))
}

function colorFor(index: number): string {
  return `var(--chart-${(index % 9) + 1})`
}

function BreakdownCard({
  title,
  data,
  index,
}: {
  title: string
  data: NameValue[]
  index: number
}) {
  return (
    <Card
      className="donut-enter flex flex-col"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        {data.length === 0 ? (
          <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
            No allocation data
          </div>
        ) : (
          <>
            {/* The bar — one segmented shape for the whole, 2px gaps between
                segments (never a seamless block a reader can't parse into parts). */}
            <div
              className="flex h-3 w-full overflow-hidden rounded-full"
              role="img"
              aria-label={`Allocation by ${title.toLowerCase().replace('by ', '')} — ${data
                .slice(0, 3)
                .map((d) => `${d.name} ${d.value.toFixed(1)}%`)
                .join(', ')}`}
              style={{ gap: '2px' }}
            >
              {data.map((d, i) => (
                <div
                  key={d.name}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${Math.max(d.value, 0.5)}%`, backgroundColor: colorFor(i) }}
                  title={`${d.name}: ${d.value.toFixed(1)}%`}
                />
              ))}
            </div>

            {/* The legend — the exact numbers, direct-labeled, never color-alone. */}
            <ul className="space-y-1.5">
              {data.map((d, i) => (
                <li key={d.name} className="flex items-center gap-2 text-xs">
                  <span
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: colorFor(i) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={d.name}>
                    {d.name}
                  </span>
                  <span className="font-medium tabular-nums">{d.value.toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function AllocationDonuts({ allocation }: { allocation: Allocation }) {
  return (
    <>
      <style>{`
        @keyframes donut-enter {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .donut-enter {
          animation: donut-enter 400ms var(--ease-out) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .donut-enter {
            animation: none !important;
          }
        }
      `}</style>
      <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3')}>
        <BreakdownCard index={0} title="By geography" data={toNameValue(allocation.byGeography)} />
        <BreakdownCard
          index={1}
          title="By platform"
          data={toNameValue(allocation.byPlatform).map((d) => ({
            ...d,
            name: platformLabel(d.name),
          }))}
        />
        <BreakdownCard
          index={2}
          title="By asset class"
          data={toNameValue(allocation.byAssetClass).map((d) => ({
            ...d,
            name: d.name.replaceAll('_', ' '),
          }))}
        />
      </div>
    </>
  )
}
