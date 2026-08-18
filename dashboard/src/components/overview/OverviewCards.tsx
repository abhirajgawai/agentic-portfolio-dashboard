/** Header metric cards — total value, day P&L, simple return, XIRR. */

import { ArrowDownRight, ArrowUpRight, Minus, TrendingUp } from 'lucide-react'

import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatInr, formatInrCompact, formatInrPrecise, formatPct, MASK_TEXT } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { simpleReturn } from '@/lib/returns'
import type { Latest, Xirr } from '@/types/contract'
import { cn } from '@/lib/utils'

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
  headline: React.ReactNode
  sub: React.ReactNode
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
function pickXirrHeadline(xirr: Xirr | undefined) {
  if (!xirr) return { rate: null, accounts: 0 }
  const entries = Object.entries(xirr.perAccount)
  const computed = entries.filter(([, e]) => e.xirrPct !== null)
  if (computed.length === 0) return { rate: null, accounts: entries.length }
  computed.sort((a, b) => b[1].terminalValue - a[1].terminalValue)
  return { rate: computed[0]?.[1].xirrPct ?? null, accounts: computed.length }
}

export function OverviewCards({ latest, xirr }: { latest: Latest; xirr: Xirr | undefined }) {
  const { totals } = latest
  const ret = simpleReturn(latest.holdings)
  const xirrInfo = pickXirrHeadline(xirr)
  const accountCurrencies = Object.entries(totals.byAccountCurrency)
  const dayPnlCurrencies = Object.entries(totals.dayPnlByAccountCurrency)
  const { masked } = usePrivacy()

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <CardShell
        title="Total value"
        hint="Consolidated portfolio value in the base currency (INR), across all platforms."
        headline={masked ? MASK_TEXT : formatInrCompact(totals.valueBase)}
        headlineClass="text-gain"
        sub={
          <span className="text-[11px]">
            {masked ? MASK_TEXT : formatInr(totals.valueBase)} ·{' '}
            {accountCurrencies.map(([ccy, v]) => `${ccy} ${masked ? MASK_TEXT : formatInrCompact(v)}`).join(' / ')}
          </span>
        }
      />
      <CardShell
        title="Day P&L"
        hint="Sum of per-holding day P&L converted to the base currency (same-run FX)."
        headline={
          <span className={cn('flex items-center gap-1', totals.dayPnl > 0 ? 'text-gain' : totals.dayPnl < 0 ? 'text-loss' : '')}>
            <DeltaIcon value={totals.dayPnl} />
            {masked ? MASK_TEXT : formatInrCompact(totals.dayPnl)}
          </span>
        }
        headlineClass={totals.dayPnl >= 0 ? 'text-gain' : 'text-loss'}
        sub={
          <span className="text-[11px]">
            {dayPnlCurrencies.length > 0
              ? dayPnlCurrencies.map(([ccy, v]) => `${ccy} ${masked ? MASK_TEXT : formatInrPrecise(v)}`).join(' / ')
              : 'no day P&L data'}
          </span>
        }
      />
      <CardShell
        title="Simple return"
        hint="(current value − cost) / cost over cost-bearing holdings. Holdings without a cost basis (CAS value-only rows) are excluded and counted."
        headline={
          <span className="flex items-center gap-1">
            <TrendingUp className="size-4 text-primary" />
            {formatPct(ret.pct)}
          </span>
        }
        headlineClass={ret.pct !== null && ret.pct >= 0 ? 'text-gain' : ret.pct !== null ? 'text-loss' : ''}
        sub={
          <span className="text-[11px]">
            {ret.withCost} with cost basis · {ret.noCost} without
          </span>
        }
      />
      <CardShell
        title="XIRR"
        hint="Per-account annualized return over captured trades (M5). Flows are kept in each account's own currency — never fabricated conversions."
        headline={<span className="tabular-nums">{xirrInfo.rate === null ? '—' : formatPct(xirrInfo.rate)}</span>}
        headlineClass={xirrInfo.rate !== null && xirrInfo.rate >= 0 ? 'text-gain' : xirrInfo.rate !== null ? 'text-loss' : ''}
        sub={
          <span className="text-[11px]">
            {xirrInfo.accounts === 0
              ? 'no captured trades yet'
              : `${xirrInfo.accounts} account${xirrInfo.accounts === 1 ? '' : 's'} with trades`}
            {xirr && Object.keys(xirr.perAccount).length > 0 && (
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