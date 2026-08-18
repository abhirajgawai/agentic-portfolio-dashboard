/** Performance screen (M8.6) — the daily performance tracker.
 *
 * Renders purely from performance.json (the fifth contract file): header
 * cards (latest value / day P&L / simple return / XIRR), a dual-axis
 * day-P&L-bars + value-line chart, a simple-return line, a per-day attribution
 * panel (dimension bars + top movers), the revaluation/import events card, and
 * a clickable daily table. Additive only — the other four contract files and
 * every existing component are untouched.
 *
 * Hooks discipline: every hook lives either before the empty-day guard (the
 * single `useState`) or in a child component that only mounts once data
 * exists — the chart `useMemo`s never straddle the guard.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus, TrendingUp } from 'lucide-react'

import { attributionBarsOption, dailyPerformanceOption, simpleReturnLineOption } from '@/components/charts/options'
import { EChart } from '@/components/charts/EChart'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { EmptyState, ErrorState, LoadingState } from '@/components/layout/states'
import { formatInr, formatInrCompact, formatInrPrecise, formatPct, MASK_TEXT, platformLabel } from '@/lib/format'
import { usePerformance } from '@/lib/data'
import { usePrivacy } from '@/lib/privacy'
import type { Performance, PerformanceDaily, PerformanceMover, PerformanceReval } from '@/types/contract'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Small shared pieces (adapted from OverviewCards — left untouched)   */
/* ------------------------------------------------------------------ */

function DeltaIcon({ value, className }: { value: number; className?: string }) {
  if (value > 0) return <ArrowUpRight className={cn('size-3.5 text-gain', className)} />
  if (value < 0) return <ArrowDownRight className={cn('size-3.5 text-loss', className)} />
  return <Minus className={cn('size-3.5 text-muted-foreground', className)} />
}

function CardShell({
  title,
  hint,
  headline,
  sub,
  headlineClass,
}: {
  title: string
  hint?: string
  headline: ReactNode
  sub: ReactNode
  headlineClass?: string
}) {
  return (
    <Card className="p-4">
      <CardTitle className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {title}
        {hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help text-muted-foreground/60">ⓘ</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{hint}</TooltipContent>
          </Tooltip>
        )}
      </CardTitle>
      <div className={cn('mt-3 text-2xl font-semibold tabular-nums tracking-tight', headlineClass)}>
        {headline}
      </div>
      <CardDescription className="mt-1.5">{sub}</CardDescription>
    </Card>
  )
}

/** Pick the XIRR headline: the largest terminal-value account's rate. */
function pickXirrHeadline(xirr: Performance['xirr']) {
  const entries = Object.entries(xirr.perAccount)
  const computed = entries.filter(([, e]) => e.xirrPct !== null)
  if (computed.length === 0) return { rate: null, accounts: entries.length }
  computed.sort((a, b) => b[1].terminalValue - a[1].terminalValue)
  return { rate: computed[0]?.[1].xirrPct ?? null, accounts: computed.length }
}

const REVAL_KIND_BADGE = {
  first_appearance: 'secondary',
  cas_import: 'warning',
  property: 'success',
  other: 'outline',
} as const

function kindLabel(kind: PerformanceReval['kind']): string {
  return kind
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/* ------------------------------------------------------------------ */
/* Header metric cards                                                 */
/* ------------------------------------------------------------------ */

function HeaderCards({ latest, xirr }: { latest: PerformanceDaily | null; xirr: Performance['xirr'] }) {
  const { masked } = usePrivacy()
  const xirrInfo = pickXirrHeadline(xirr)
  const money = (v: number | null | undefined) => {
    if (v === null || v === undefined) return '—'
    return masked ? MASK_TEXT : formatInrCompact(v)
  }
  const dayPnlCurrencies = latest ? Object.entries(latest.brokerDayPnl) : []

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <CardShell
        title="Latest value"
        hint="Portfolio value in the base currency (INR) on the most recent performance day."
        headline={money(latest?.valueBase)}
        headlineClass="text-gain"
        sub={
          <span className="text-[11px]">
            {latest ? `as of ${latest.date}` : 'no performance days yet'}
          </span>
        }
      />
      <CardShell
        title="Day P&L"
        hint="The latest day's P&L in the base currency — the sum of per-holding moves that day."
        headline={
          latest ? (
            <span
              className={cn(
                'flex items-center gap-1',
                latest.dayPnlBase > 0 ? 'text-gain' : latest.dayPnlBase < 0 ? 'text-loss' : '',
              )}
            >
              <DeltaIcon value={latest.dayPnlBase} />
              {money(latest.dayPnlBase)}
            </span>
          ) : (
            '—'
          )
        }
        headlineClass={latest && latest.dayPnlBase >= 0 ? 'text-gain' : latest ? 'text-loss' : ''}
        sub={
          <span className="text-[11px]">
            {dayPnlCurrencies.length > 0
              ? dayPnlCurrencies
                  .map(([p, v]) => `${platformLabel(p)} ${masked ? MASK_TEXT : formatInrPrecise(v)}`)
                  .join(' / ')
              : latest
                ? 'no broker day P&L'
                : '—'}
          </span>
        }
      />
      <CardShell
        title="Simple return"
        hint="(value − cost) / cost over cost-bearing holdings on the latest performance day. Holdings without a cost basis (CAS value-only rows) are excluded and counted."
        headline={
          <span className="flex items-center gap-1">
            <TrendingUp className="size-4 text-primary" />
            {formatPct(latest?.simpleReturnPct ?? null)}
          </span>
        }
        headlineClass={
          latest && latest.simpleReturnPct !== null && latest.simpleReturnPct >= 0
            ? 'text-gain'
            : latest && latest.simpleReturnPct !== null
              ? 'text-loss'
              : ''
        }
        sub={
          <span className="text-[11px]">
            {latest
              ? `${latest.costCoverage.withCost} with cost basis · ${latest.costCoverage.noCost} without`
              : '—'}
          </span>
        }
      />
      <CardShell
        title="XIRR"
        hint="Per-account annualized return over captured trades (M5), from the performance payload. Flows are kept in each account's own currency."
        headline={<span className="tabular-nums">{xirrInfo.rate === null ? '—' : formatPct(xirrInfo.rate)}</span>}
        headlineClass={xirrInfo.rate !== null && xirrInfo.rate >= 0 ? 'text-gain' : xirrInfo.rate !== null ? 'text-loss' : ''}
        sub={
          <span className="text-[11px]">
            {xirrInfo.accounts === 0
              ? 'no captured trades yet'
              : `${xirrInfo.accounts} account${xirrInfo.accounts === 1 ? '' : 's'} with trades`}
            {Object.keys(xirr.perAccount).length > 0 && (
              <span className="ml-1 text-muted-foreground/70">
                [{Object.values(xirr.perAccount)
                  .map((e) => e.currency)
                  .join(', ')}]
              </span>
            )}
          </span>
        }
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Charts                                                              */
/* ------------------------------------------------------------------ */

/** Dual-axis: day-P&L bars (left) + portfolio value area line (right). */
function DualAxisChart({ daily, masked }: { daily: PerformanceDaily[]; masked: boolean }) {
  const option = useMemo(
    () =>
      dailyPerformanceOption({
        dates: daily.map((d) => d.date),
        dayPnl: daily.map((d) => d.dayPnlBase),
        value: daily.map((d) => d.valueBase),
        formatter: formatInrCompact,
        masked,
      }),
    [daily, masked],
  )
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-muted-foreground">
          Daily P&L (bars) vs portfolio value (line, base currency)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {daily.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
            No performance days yet — appears after the first export
          </div>
        ) : (
          <EChart option={option} height={280} />
        )}
      </CardContent>
    </Card>
  )
}

/** Simple-return line over the same dates (percentages — never masked). */
function SimpleReturnChart({ daily }: { daily: PerformanceDaily[] }) {
  const option = useMemo(
    () =>
      simpleReturnLineOption({
        dates: daily.map((d) => d.date),
        values: daily.map((d) => d.simpleReturnPct),
      }),
    [daily],
  )
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-muted-foreground">
          Simple return over time (cost-bearing holdings)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {daily.length === 0 ? (
          <div className="flex h-56 items-center justify-center text-xs text-muted-foreground">
            No performance days yet
          </div>
        ) : (
          <EChart option={option} height={200} />
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Attribution panel — one selected day                                */
/* ------------------------------------------------------------------ */

const DIMENSIONS = [
  { key: 'byGeography', label: 'Geography' },
  { key: 'byPlatform', label: 'Platform' },
  { key: 'byAssetClass', label: 'Asset class' },
] as const

function MoversTable({ movers }: { movers: PerformanceMover[] }) {
  const { masked } = usePrivacy()
  if (movers.length === 0) {
    return <p className="text-xs text-muted-foreground">No top movers recorded for this day.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Ticker</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Name</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Platform</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Geography</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Day P&L (₹)</th>
          </tr>
        </thead>
        <tbody>
          {movers.map((m) => (
            <tr key={`${m.platform}:${m.ticker}`} className="border-b border-border/50 last:border-0">
              <td className="px-3 py-2 font-medium tabular-nums">{m.ticker}</td>
              <td className="px-3 py-2">{m.name ?? '—'}</td>
              <td className="px-3 py-2">
                <Badge variant="secondary" className="font-normal">
                  {platformLabel(m.platform)}
                </Badge>
              </td>
              <td className="px-3 py-2">{m.geography}</td>
              <td
                className={cn(
                  'px-3 py-2 text-right tabular-nums',
                  m.dayPnlBase > 0 ? 'text-gain' : m.dayPnlBase < 0 ? 'text-loss' : 'text-muted-foreground',
                )}
              >
                {masked ? MASK_TEXT : formatInrCompact(m.dayPnlBase)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AttributionPanel({
  daily,
  selected,
  onSelectDate,
}: {
  daily: PerformanceDaily[]
  selected: PerformanceDaily
  onSelectDate: (date: string) => void
}) {
  const { masked } = usePrivacy()

  const dimensionOptions = useMemo(
    () =>
      DIMENSIONS.map((dim) => {
        const attr = selected.attribution[dim.key]
        const entries = attr ? Object.entries(attr).sort(([a], [b]) => a.localeCompare(b)) : []
        return {
          key: dim.key,
          label: dim.label,
          count: entries.length,
          option: attributionBarsOption({
            labels: entries.map(([k]) => k),
            values: entries.map(([, v]) => v),
            formatter: formatInrCompact,
            masked,
          }),
        }
      }),
    [selected, masked],
  )

  const movers = useMemo(
    () => [...selected.topMovers].sort((a, b) => Math.abs(b.dayPnlBase) - Math.abs(a.dayPnlBase)),
    [selected],
  )

  return (
    <Card>
      <CardHeader className="flex-col gap-2 pb-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-xs text-muted-foreground">
            Day P&L attribution — {selected.date}
          </CardTitle>
          <CardDescription className="mt-0.5">
            Every dimension sums to the day's P&L (M3.5 reconciliation invariant)
          </CardDescription>
        </div>
        {/* Newest-first options; the default selection is the latest day. */}
        <select
          value={selected.date}
          onChange={(e) => onSelectDate(e.target.value)}
          aria-label="Select day"
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {[...daily]
            .reverse()
            .map((d) => (
              <option key={d.date} value={d.date}>
                {d.date}
              </option>
            ))}
        </select>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {dimensionOptions.map((dim) => (
            <div key={dim.key}>
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">{dim.label}</p>
              {dim.count === 0 ? (
                <p className="text-xs text-muted-foreground">No attribution recorded for this day</p>
              ) : (
                <EChart option={dim.option} height={Math.min(200, Math.max(90, dim.count * 18))} />
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-border/50 pt-3">
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">
            Top movers (by |day P&L|)
          </p>
          <MoversTable movers={movers} />
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Revaluation events — separate card, clearly NOT daily P&L           */
/* ------------------------------------------------------------------ */

function RevalCard({ events, date }: { events: PerformanceReval[]; date: string }) {
  const { masked } = usePrivacy()
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-muted-foreground">
          Revaluation / import events for {date} — NOT daily P&L
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {events.length === 0 ? (
          <p className="px-4 pb-4 text-xs text-muted-foreground">
            No revaluation events on this day — imported holdings only revalue on their statement /
            import dates.
          </p>
        ) : (
          <ul>
            {events.map((e) => (
              <li
                key={`${e.platform}:${e.ticker}:${e.kind}`}
                className="flex items-start gap-3 border-b border-border/50 px-4 py-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium tabular-nums">{e.ticker}</span>
                    <Badge variant={REVAL_KIND_BADGE[e.kind]} className="font-normal">
                      {kindLabel(e.kind)}
                    </Badge>
                    {e.name && <span className="truncate text-xs text-muted-foreground">{e.name}</span>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{platformLabel(e.platform)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className={cn(
                      'text-sm font-medium tabular-nums',
                      e.changeBase > 0 ? 'text-gain' : e.changeBase < 0 ? 'text-loss' : 'text-muted-foreground',
                    )}
                  >
                    {masked ? MASK_TEXT : formatInrCompact(e.changeBase)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {e.intervalDays === null ? '—' : `over ${e.intervalDays} day${e.intervalDays === 1 ? '' : 's'}`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Daily table — row click selects the attribution day                 */
/* ------------------------------------------------------------------ */

function DailyTable({
  daily,
  activeDate,
  onSelect,
}: {
  daily: PerformanceDaily[]
  activeDate: string
  onSelect: (date: string) => void
}) {
  const { masked } = usePrivacy()
  return (
    <Card className="overflow-hidden">
      <div className="border-b px-3 py-2">
        <span className="text-xs text-muted-foreground">
          Daily performance · {daily.length} day{daily.length === 1 ? '' : 's'} — click a row to inspect
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Date</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Value (₹)</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Day P&L (₹)</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Day P&L %</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Simple return %</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Cost coverage</th>
            </tr>
          </thead>
          <tbody>
            {[...daily].reverse().map((d) => {
              const isActive = d.date === activeDate
              return (
                <tr
                  key={d.date}
                  onClick={() => onSelect(d.date)}
                  title={`Inspect ${d.date}`}
                  className={cn(
                    'cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-accent/40',
                    isActive && 'bg-accent/60',
                  )}
                >
                  <td className="px-3 py-2 tabular-nums">{d.date}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {masked ? MASK_TEXT : formatInr(d.valueBase)}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right tabular-nums',
                      d.dayPnlBase > 0 ? 'text-gain' : d.dayPnlBase < 0 ? 'text-loss' : 'text-muted-foreground',
                    )}
                  >
                    {masked ? MASK_TEXT : formatInr(d.dayPnlBase)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {d.dayPnlPct === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={d.dayPnlPct > 0 ? 'text-gain' : d.dayPnlPct < 0 ? 'text-loss' : 'text-muted-foreground'}>
                        {formatPct(d.dayPnlPct)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {d.simpleReturnPct === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={d.simpleReturnPct > 0 ? 'text-gain' : d.simpleReturnPct < 0 ? 'text-loss' : 'text-muted-foreground'}
                      >
                        {formatPct(d.simpleReturnPct)}
                      </span>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 text-right tabular-nums text-muted-foreground"
                    title={`${d.costCoverage.withCost} with cost basis · ${d.costCoverage.noCost} without`}
                  >
                    {d.costCoverage.withCost} / {d.costCoverage.noCost}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

export function PerformanceScreen() {
  const perf = usePerformance()

  if (perf.isLoading) return <LoadingState label="Loading performance…" />
  if (perf.isError) {
    return (
      <ErrorState
        message={perf.error instanceof Error ? perf.error.message : String(perf.error)}
        onRetry={() => void perf.refetch()}
      />
    )
  }
  if (!perf.data) return null

  return <PerformanceBody perf={perf.data} />
}

function PerformanceBody({ perf }: { perf: Performance }) {
  // Hooks above the empty-day guard (hook order must never straddle the
  // return); the chart/panel hooks live in the child components below.
  const { masked } = usePrivacy()
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const daily = perf.daily
  const latest = daily[daily.length - 1]

  if (!latest) {
    return (
      <div className="space-y-4">
        <HeaderCards latest={null} xirr={perf.xirr} />
        <EmptyState
          icon={TrendingUp}
          title="No performance days yet"
          description="The daily performance export (performance.json) has no entries — it appears after the first pipeline export that includes daily tracking."
        />
      </div>
    )
  }

  // Default selection = latest day; a picked date that disappeared after a
  // refresh falls back to the latest.
  const selected = selectedDate ? (daily.find((d) => d.date === selectedDate) ?? latest) : latest

  return (
    <div className="space-y-4">
      <HeaderCards latest={latest} xirr={perf.xirr} />
      <DualAxisChart daily={daily} masked={masked} />
      <SimpleReturnChart daily={daily} />
      <AttributionPanel daily={daily} selected={selected} onSelectDate={setSelectedDate} />
      <RevalCard events={selected.revaluationEvents} date={selected.date} />
      <DailyTable daily={daily} activeDate={selected.date} onSelect={setSelectedDate} />
    </div>
  )
}
