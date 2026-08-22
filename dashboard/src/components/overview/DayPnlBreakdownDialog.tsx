/**
 * Day P&L breakdown dialog — the "what makes up the card number" view behind
 * the Overview Day P&L card.
 *
 * Derivation lives in lib/dayPnl (pure, deterministic — Σ platform basePnl
 * reconciles to latest.totals.dayPnl within 0.01 by construction, since both
 * use the SAME fxToInr conversion). This component is display-only: it rounds
 * to 2dp, formats currencies with Intl and applies the privacy mask — it never
 * re-derives a number.
 *
 * Honesty notes (project culture):
 *   - Only live broker legs carry day P&L (zerodha INR, moomoo USD); CAS rows
 *     (groww/sharekhan), real estate and the CAS-imported Zerodha MF are
 *     excluded and counted (excludedCount), never fabricated.
 *   - The reconciliation footer is computed from the data and shows an honest
 *     Δ when Σ != the card (tolerance 0.01 INR).
 */

import { useMemo } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { dayPnlBreakdown, type DayPnlPlatformRow } from '@/lib/dayPnl'
import { formatAsOf, formatInrCompact, formatInrPrecise, formatMoney, MASK_TEXT, platformLabel } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { cn } from '@/lib/utils'
import type { Latest } from '@/types/contract'

/* ------------------------------------------------------------------ */
/* Display helpers (rounding + formatting live ONLY here)              */
/* ------------------------------------------------------------------ */

function DeltaIcon({ value, className }: { value: number; className?: string }) {
  if (value > 0) return <ArrowUpRight className={cn('size-3.5 text-gain', className)} />
  if (value < 0) return <ArrowDownRight className={cn('size-3.5 text-loss', className)} />
  return <Minus className={cn('size-3.5 text-muted-foreground', className)} />
}

/** Gain/loss token for a signed amount (0 → muted). */
function pnlClass(value: number): string {
  if (value > 0) return 'text-gain'
  if (value < 0) return 'text-loss'
  return 'text-muted-foreground'
}

const nativeFmtCache = new Map<string, Intl.NumberFormat | null>()

/** Amount in its settlement currency: $111.20 / ₹8,801.38 / S$141.76.
 *  Intl currency formatter, falling back to "<CODE> <value.toFixed(2)>" for
 *  an unknown currency code (never a crash). */
function formatNative(value: number, currency: string): string {
  let cached = nativeFmtCache.get(currency)
  if (cached === undefined) {
    try {
      cached = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 })
    } catch {
      cached = null
    }
    nativeFmtCache.set(currency, cached)
  }
  if (cached === null) return `${currency} ${value.toFixed(2)}`
  return cached.format(value)
}

/** Platform display label — real_estate reads "Real estate", others Title Case. */
function platformDisplayLabel(platform: string): string {
  if (platform === 'real_estate') return 'Real estate'
  return platformLabel(platform)
}

/* ------------------------------------------------------------------ */
/* Platform row (summary = the row; <details> keeps it keyboard-native) */
/* ------------------------------------------------------------------ */

function PlatformRow({ row, masked }: { row: DayPnlPlatformRow; masked: boolean }) {
  const native = formatNative(row.nativePnl, row.currency)
  return (
    <details className="group rounded-md" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
          <span className="truncate text-sm font-medium">{platformDisplayLabel(row.platform)}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {row.holdings.length} holding{row.holdings.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className="flex shrink-0 items-baseline gap-2 text-xs tabular-nums">
          {row.currency === 'INR' ? (
            <span className="text-muted-foreground">
              {masked ? MASK_TEXT : native}
              <span className="ml-1">(INR)</span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              {masked ? MASK_TEXT : `${native} ${row.currency}`}
              <span className="mx-1">×</span>
              {masked ? MASK_TEXT : row.fxRate.toFixed(2)}
            </span>
          )}
          <span className={cn('w-24 text-right text-sm font-semibold', pnlClass(row.basePnl))}>
            {masked ? MASK_TEXT : formatInrPrecise(row.basePnl)}
          </span>
        </span>
      </summary>
      <ul className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3">
        {row.holdings.map((h) => (
          <li
            key={h.ticker}
            className="flex items-center justify-between gap-3 py-0.5 text-xs"
          >
            <span className="min-w-0 truncate" title={h.name ?? h.ticker}>
              <span className="font-medium">{h.ticker}</span>
              {h.name && <span className="ml-1.5 text-muted-foreground">{h.name}</span>}
            </span>
            <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
              <span className="text-muted-foreground">
                {masked ? MASK_TEXT : formatNative(h.nativePnl, h.currency)}
              </span>
              <span className={cn('w-20 text-right', pnlClass(h.basePnl))}>
                {masked ? MASK_TEXT : formatInrPrecise(h.basePnl)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function DayPnlBreakdownDialog({
  latest,
  open,
  onOpenChange,
}: {
  latest: Latest
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const breakdown = useMemo(() => dayPnlBreakdown(latest), [latest])
  const { masked } = usePrivacy()

  const currencyEntries = Object.entries(latest.totals.dayPnlByAccountCurrency)

  // Reconciliation vs the card number — computed from data, tolerance 0.01 INR.
  const delta = breakdown === null ? null : Math.abs(breakdown.total - latest.totals.dayPnl)
  const matches = delta !== null && delta <= 0.01

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Day P&L breakdown</DialogTitle>
          <DialogDescription>
            Live broker-reported day P&L, converted with the export&apos;s same-run FX
            · as of {formatAsOf(latest.asOf)}
          </DialogDescription>
        </DialogHeader>

        {breakdown === null ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No live day P&L data
          </div>
        ) : (
          <div className="space-y-3">
            {/* Headline: total + per-account-currency sub-line (mirrors the card). */}
            <div className="rounded-md border border-border p-3">
              <div
                className={cn(
                  'flex items-center gap-1.5 text-2xl font-semibold tabular-nums tracking-tight',
                  pnlClass(breakdown.total),
                )}
              >
                <DeltaIcon value={breakdown.total} />
                {masked ? MASK_TEXT : formatInrCompact(breakdown.total)}
              </div>
              <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                {currencyEntries.length > 0
                  ? currencyEntries
                      .map(([ccy, v]) => `${ccy} ${masked ? MASK_TEXT : formatMoney(v, ccy)}`)
                      .join(' / ')
                  : 'no day P&L data'}
              </div>
            </div>

            {/* Per-platform rows with the FX math explicit. */}
            <div className="space-y-0.5">
              {breakdown.platforms.map((row) => (
                <PlatformRow key={row.id} row={row} masked={masked} />
              ))}
            </div>

            {/* Reconciliation footer — honest, computed, never hardcoded. */}
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] tabular-nums text-muted-foreground">
              {matches ? (
                <>
                  Σ platforms = {masked ? MASK_TEXT : formatInrPrecise(breakdown.total)} — matches the Day P&L card
                </>
              ) : (
                <>
                  Σ platforms = {masked ? MASK_TEXT : formatInrPrecise(breakdown.total)} — Δ{' '}
                  {masked ? MASK_TEXT : formatInrPrecise(breakdown.total - latest.totals.dayPnl)} vs card
                </>
              )}
              {breakdown.excludedCount > 0 && (
                <span className="ml-2 text-muted-foreground/80">
                  · {breakdown.excludedCount} holding{breakdown.excludedCount === 1 ? '' : 's'} excluded (no live day P&L)
                </span>
              )}
            </div>

            {/* Honest footnote (fixed text) + the excluded platforms list. */}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Day P&L covers live broker legs only (zerodha, moomoo). Groww-CAS and real-estate
              holdings have no live day P&L — their value changes appear as revaluation events on
              the Performance tab.
              {breakdown.noDayPnlPlatforms.length > 0 && (
                <span className="mt-1 block">
                  No live day P&L: {breakdown.noDayPnlPlatforms.map(platformDisplayLabel).join(', ')}.
                </span>
              )}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}