/**
 * SegmentCard — one of the four segment cards (spec-round2/segments-workspace
 * §3). The WHOLE card is ONE button: activating it writes the segment's
 * cross-filter and opens the breakdown (both handled by the parent screen, per
 * §4.1). The card is presentational — every number arrives via `segment`
 * (derived deterministically by src/lib/segments.ts) and every interaction via
 * props.
 *
 * Slots (spec §3.2): header (icon + label + count badge + chevron), value
 * (₹ headline + per-segment sub-line), pnl (broker-LIVE day P&L; "—" + honest
 * note for CAS-derived legs, which have no live day P&L), return (simple
 * return + cost coverage — never hidden), meta (staleness badge/fresh dot +
 * per-platform as-of tooltip).
 *
 * A11y (spec §7.2): whole-card button, `aria-pressed` on the active-ring
 * state, focus ring via ring-ring (AA in both themes), stale badge with a
 * per-platform aria-label. Motion (spec §7.1): hover shadow + 2px rise (150ms),
 * press scale 0.98 (100ms) — transform/box-shadow only; the global
 * prefers-reduced-motion rule in index.css makes it instant.
 */

import { useMemo } from 'react'
import { ChevronRight, Globe2, Layers, MapPin } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAnimatedNumber } from '@/components/journey/animation'
import { useLatest } from '@/lib/data'
import { formatAsOf, formatInrCompact, formatSgd, MASK_TEXT, platformLabel } from '@/lib/format'
import { staleThresholdDays, type SegmentSummary } from '@/lib/segments'
import { cn } from '@/lib/utils'

/** Per-segment header glyph (spec §6.2 — no new tokens, no new components). */
const SEGMENT_ICONS = {
  us: Globe2,
  india: MapPin,
  consolidated: Layers,
} as const

/** platformLabel + the snake_case special case (real_estate → "Real estate"). */
function platformDisplay(platform: string): string {
  return platform === 'real_estate' ? 'Real estate' : platformLabel(platform)
}

const MS_PER_DAY = 86_400_000

/** Days PAST a platform's threshold, measured against the export's own
 *  reference instant (latest.asOf) — mirrors segments.ts::segmentStaleness,
 *  recomputed here per platform for the tooltip/aria-label. Deterministic:
 *  both timestamps come from the data files, never the wall clock. */
function platformDaysPast(
  platform: string,
  asOf: string | null,
  platformAsOf: string | null,
): number {
  if (!asOf || !platformAsOf) return Number.POSITIVE_INFINITY
  const age = (new Date(asOf).getTime() - new Date(platformAsOf).getTime()) / MS_PER_DAY
  return Number.isNaN(age) ? Number.POSITIVE_INFINITY : Math.max(0, age - staleThresholdDays(platform))
}

/** Simple return with ONE decimal (card convention, spec §3.2) or "—". */
function pct1(value: number | null): string | null {
  if (value === null) return null
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

/** Signed compact ₹ (card convention) or "—". */
function signedCompact(value: number | null): string | null {
  if (value === null) return null
  return `${value >= 0 ? '+' : ''}${formatInrCompact(value)}`
}

interface SegmentCardProps {
  segment: SegmentSummary
  /** 'featured' = the Consolidated hero (larger padding, primary accent). */
  variant?: 'featured' | 'default'
  /** The active filter set currently matches this segment (read-highlight
   *  §1.2 — cards never shrink, they ring). */
  active: boolean
  /** Privacy masking — money becomes MASK_TEXT; pct/counts stay visible. */
  masked: boolean
  /** data-density="compact" tightens card padding (spec §9). */
  compact?: boolean
  /** US-only: the account-currency day P&L (latest.totals.dayPnlByAccountCurrency
   *  .SGD) for the "≈ +SGD 141.8" sub-line. Null elsewhere. */
  accountPnlSgd?: number | null
  onOpen: () => void
}

export function SegmentCard({
  segment,
  variant = 'default',
  active,
  masked,
  compact = false,
  accountPnlSgd = null,
  onOpen,
}: SegmentCardProps) {
  const latest = useLatest()
  const data = latest.data
  const Icon = SEGMENT_ICONS[segment.id]
  const featured = variant === 'featured'

  // Delta counters on refresh (motion-spec §2 — 400ms, instant under
  // prefers-reduced-motion). Shared with the Journey headline.
  const animatedValue = useAnimatedNumber(segment.valueBase)
  const animatedPnl = useAnimatedNumber(segment.dayPnlLive ?? 0)

  // India's "incl. real estate" sub-line — derived, never hardcoded.
  const realEstateValue = useMemo(
    () =>
      segment.holdings
        .filter((h) => h.platform === 'real_estate')
        .reduce((sum, h) => sum + h.valueBase, 0),
    [segment.holdings],
  )

  // Per-platform staleness for the meta tooltip + stale-badge aria-label.
  const platformStaleness = useMemo(
    () =>
      [...new Set(segment.holdings.map((h) => h.platform))]
        .sort()
        .map((p) => ({
          platform: p,
          label: platformDisplay(p),
          daysPast: platformDaysPast(p, data?.asOf ?? null, data?.platforms[p]?.asOf ?? null),
          threshold: staleThresholdDays(p),
        })),
    [segment.holdings, data],
  )

  const staleAria = platformStaleness
    .filter((p) => p.daysPast > 0)
    .map((p) => `${p.label} ${Math.round(p.daysPast)} days past ${p.threshold}-day threshold`)
    .join(', ')

  // Value sub-line per segment (spec §3.3).
  let valueSubLine: string
  if (segment.id === 'us' && segment.displayValue !== null) {
    valueSubLine = masked ? `≈ ${MASK_TEXT}` : `≈ ${formatSgd(segment.displayValue)}`
  } else if (segment.id === 'india' && realEstateValue > 0) {
    valueSubLine = masked
      ? `incl. real estate ${MASK_TEXT}`
      : `incl. real estate ${formatInrCompact(realEstateValue)}`
  } else {
    valueSubLine = 'all platforms'
  }

  const ariaValue = masked ? 'value hidden' : formatInrCompact(segment.valueBase)
  const ariaLabel = `${segment.label} segment — ${segment.holdings.length} holdings, value ${ariaValue} — open breakdown`

  const empty = segment.holdings.length === 0
  const pnl = signedCompact(segment.dayPnlLive)
  const ret = pct1(segment.simpleReturnPct)

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={cn(
        'group relative flex w-full flex-col gap-2 rounded-lg border bg-card text-left text-card-foreground shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]',
        compact ? 'p-3' : featured ? 'p-5' : 'p-4',
        featured ? 'border-primary/25 bg-primary/[0.03]' : '',
        active ? 'border-ring ring-1 ring-ring' : '',
      )}
    >
      {/* Header: icon + label + count + chevron affordance */}
      <span className="flex w-full items-center gap-2">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md',
            featured ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="text-sm font-semibold">{segment.label}</span>
        <Badge variant="secondary" className="text-[10px] font-normal tabular-nums">
          {segment.holdings.length}
        </Badge>
        <ChevronRight className="ml-auto size-4 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
      </span>

      {/* Value: ₹ headline + sub-line */}
      <span className="flex flex-col gap-0.5">
        <span
          className={cn(
            'font-semibold tabular-nums tracking-tight',
            featured ? 'font-headline text-3xl text-primary' : 'text-2xl',
          )}
        >
          {masked || empty ? MASK_TEXT : formatInrCompact(animatedValue)}
        </span>
        <span className="text-xs text-muted-foreground">
          {empty ? 'No holdings in this segment' : valueSubLine}
        </span>
      </span>

      {/* Day P&L — broker-live; "—" with honest note for CAS (no live legs) */}
      <span className="flex items-baseline gap-1.5">
        <span className="text-xs text-muted-foreground">Day P&L</span>
        {empty || pnl === null ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs font-medium text-muted-foreground">—</span>
            </TooltipTrigger>
            <TooltipContent className="py-1 text-xs">
              CAS re-prices on monthly import — never a one-day move
            </TooltipContent>
          </Tooltip>
        ) : (
          <>
            <span
              className={cn(
                'text-sm font-medium tabular-nums',
                (segment.dayPnlLive ?? 0) >= 0 ? 'text-gain' : 'text-loss',
              )}
            >
              {masked ? MASK_TEXT : signedCompact(animatedPnl)}
            </span>
            {accountPnlSgd !== null && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {masked
                      ? MASK_TEXT
                      : `≈ ${accountPnlSgd >= 0 ? '+' : ''}SGD ${Math.abs(accountPnlSgd).toFixed(1)}`}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="py-1 text-xs">
                  Account-currency day P&L (matches the broker view)
                </TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </span>

      {/* Simple return + cost coverage — the 20/69 no-cost reality stays visible */}
      <span className="flex items-baseline gap-1.5">
        <span className="text-xs text-muted-foreground">Simple return</span>
        {empty || ret === null ? (
          <span className="text-xs font-medium text-muted-foreground">—</span>
        ) : (
          <>
            <span
              className={cn(
                'text-sm font-medium tabular-nums',
                (segment.simpleReturnPct ?? 0) >= 0 ? 'text-gain' : 'text-loss',
              )}
            >
              {ret}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {segment.costCoverage.withCost} of {segment.holdings.length} with cost basis
            </span>
          </>
        )}
      </span>

      {/* Meta: stale badge / fresh dot + as-of (per-platform tooltip) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="mt-0.5 flex w-full items-center gap-1.5 text-[11px] text-muted-foreground">
            {segment.stale ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning"
                aria-label={staleAria || 'stale'}
              >
                <span className="size-1.5 rounded-full bg-warning" />
                stale
                {segment.staleDaysPast !== null && Number.isFinite(segment.staleDaysPast)
                  ? ` · ${Math.round(segment.staleDaysPast)}d`
                  : ''}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1" aria-label="fresh">
                <span className="size-1.5 rounded-full bg-gain" />
                fresh
              </span>
            )}
            <span className="truncate">As of {formatAsOf(segment.asOf)}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-56 py-1 text-xs">
          <ul className="space-y-0.5">
            {platformStaleness.map((p) => (
              <li key={p.platform}>
                {p.label} —{' '}
                {p.daysPast > 0
                  ? `${Math.round(p.daysPast)}d past ${p.threshold}d threshold`
                  : `fresh (${p.threshold}d threshold)`}
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </button>
  )
}