/**
 * Today panel — the day in words: day P&L headline ("Down ₹19.5k today"), an
 * account-currency leg breakdown (latest.json dayPnlByAccountCurrency — the
 * contract keys by CURRENCY, not platform), the top mover (largest |day
 * change %| — percentages survive the privacy mask by design) and today's
 * alert count.
 *
 * Money is privacy-masked; the headline ticks with a delta counter on refresh
 * (motion-spec §2, via ./animation) unless the user prefers reduced motion,
 * and the FINAL value is announced once via an sr-only aria-live region (no
 * mid-tick chatter, a11y-spec §5).
 *
 * Live polling: during market hours (IN 09:15–15:30 IST, US 19:00–02:30 IST),
 * polls /api/live every 60s when tab is visible. Merges live dayPnl/dayChangePct
 * into the base latest data for day P&L, top mover, gainers/losers.
 */

import { BellRing, MoveUpRight, Activity, Clock, Globe } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { DayPnlBreakdownDialog } from '@/components/overview/DayPnlBreakdownDialog'
import { dayPnlBreakdown } from '@/lib/dayPnl'
import { formatAsOf, formatInrCompact, formatInrPrecise, formatPct, formatSgd, MASK_TEXT, platformLabel } from '@/lib/format'
import { isMarketHoursNow, getActiveMarketLabel, msUntilNextMarketOpen } from '@/lib/marketHours'
import { usePrivacy } from '@/lib/privacy'
import { cn } from '@/lib/utils'
import type { Alerts, Latest } from '@/types/contract'
import { livePoll, type LiveHolding } from '@/lib/api'
import { useAnimatedNumber } from './animation'

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

type DayMover = Latest['holdings'][number]
type LiveDayMover = Omit<DayMover, 'dayChangePct'> & { dayChangePct: number }

function hasDayChange(holding: DayMover): holding is LiveDayMover {
  return holding.dayChangePct !== null
}

/** Largest |day change %| among holdings with a live day move. */
function topMover(
  latest: Latest,
): { ticker: string; pct: number; holding: LiveDayMover } | null {
  let best: { ticker: string; pct: number; holding: LiveDayMover } | null = null
  for (const holding of latest.holdings) {
    if (!hasDayChange(holding)) continue
    const magnitude = Math.abs(holding.dayChangePct)
    if (!best || magnitude > Math.abs(best.pct)) {
      best = { ticker: holding.ticker, pct: holding.dayChangePct, holding }
    }
  }
  return best
}

/** Top positive/negative percentage moves, keeping null day data out. */
function dayMovers(latest: Latest) {
  const movers = latest.holdings.filter(hasDayChange)
  return {
    gainers: movers
      .filter((holding) => holding.dayChangePct > 0)
      .sort((a, b) => b.dayChangePct - a.dayChangePct)
      .slice(0, 3),
    losers: movers
      .filter((holding) => holding.dayChangePct < 0)
      .sort((a, b) => a.dayChangePct - b.dayChangePct)
      .slice(0, 3),
  }
}

/** Account-currency -> human leg label (INR ≈ India leg, SGD ≈ US/moomoo). */
const LEG_LABELS: Record<string, string> = { INR: 'India (INR)', SGD: 'US (SGD)' }
const legLabel = (ccy: string) => LEG_LABELS[ccy] ?? ccy

/** Signed display value in the leg's own currency. */
function formatLegValue(ccy: string, value: number): string {
  const sign = value > 0 ? '+' : ''
  if (ccy === 'SGD') return `${sign}${formatSgd(value)}`
  return `${sign}${formatInrCompact(value)}`
}

type PlatformDayPnl = Map<string, Map<string, number>>

/** Group usable native day P&L by display currency, then platform. */
function platformDayPnl(latest: Latest): PlatformDayPnl {
  const byCurrency: PlatformDayPnl = new Map()
  for (const holding of latest.holdings) {
    const value =
      holding.currency === holding.displayCurrency && holding.dayPnl !== null
        ? holding.dayPnl
        : holding.dayChangePct !== null
          ? (holding.valueDisplay * holding.dayChangePct) / 100
          : null
    if (value === null) continue

    const byPlatform = byCurrency.get(holding.displayCurrency) ?? new Map<string, number>()
    byPlatform.set(holding.platform, (byPlatform.get(holding.platform) ?? 0) + value)
    byCurrency.set(holding.displayCurrency, byPlatform)
  }
  return byCurrency
}

/** Signed P&L in the account's display currency, not the broker currency. */
function formatHoldingDayPnl(holding: LiveDayMover): string {
  const value =
    holding.currency === holding.displayCurrency && holding.dayPnl !== null
      ? holding.dayPnl
      : (holding.valueDisplay * holding.dayChangePct) / 100
  const sign = value > 0 ? '+' : ''
  const formatted = holding.displayCurrency === 'SGD'
    ? formatSgd(Math.abs(value))
    : formatInrCompact(Math.abs(value))
  return `${sign}${value < 0 ? '-' : ''}${formatted}`
}

/** Native-currency amount for the inline, computed FX explanation. */
function formatNativePnl(value: number, currency: string): string {
  if (currency === 'INR') return formatInrPrecise(value)
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

/** Merge live day fields into base holdings (by ticker+platform key). */
function mergeLiveIntoLatest(latest: Latest, liveHoldings: LiveHolding[], liveAsOf: string | null): Latest {
  const liveMap = new Map<string, LiveHolding>()
  for (const h of liveHoldings) {
    liveMap.set(`${h.platform}:${h.ticker}`, h)
  }

  return {
    ...latest,
    holdings: latest.holdings.map((h) => {
      const live = liveMap.get(`${h.platform}:${h.ticker}`)
      if (!live) return h
      return {
        ...h,
        dayPnl: live.dayPnl ?? h.dayPnl,
        dayChangePct: live.dayChangePct ?? h.dayChangePct,
        valueDisplay: live.valueDisplay ?? h.valueDisplay,
      }
    }),
    totals: {
      ...latest.totals,
      dayPnl: latest.totals.dayPnl, // keep base; we'll compute display from merged holdings
      dayPnlByAccountCurrency: latest.totals.dayPnlByAccountCurrency,
    },
    asOf: liveAsOf ?? latest.asOf,
  }
}

/** Compute dayPnlByAccountCurrency from merged holdings (for leg breakdown). */
function recomputeDayPnlByCurrency(holdings: Latest['holdings']): Record<string, number> {
  const byCurrency: Record<string, number> = {}
  for (const h of holdings) {
    if (h.dayPnl !== null && h.currency === h.displayCurrency) {
      byCurrency[h.displayCurrency] = (byCurrency[h.displayCurrency] ?? 0) + h.dayPnl
    } else if (h.dayChangePct !== null) {
      const est = (h.valueDisplay * h.dayChangePct) / 100
      byCurrency[h.displayCurrency] = (byCurrency[h.displayCurrency] ?? 0) + est
    }
  }
  return byCurrency
}

/** Compute consolidated dayPnl in base currency (INR) from merged holdings.
 *  Mirrors export_json.py's _to() logic: USD→INR via USDINR, INR stays INR. */
function recomputeConsolidatedDayPnl(holdings: Latest['holdings'], usdInr: number): number {
  let total = 0
  for (const h of holdings) {
    if (h.dayPnl === null) continue
    if (h.currency === 'USD') {
      total += h.dayPnl * usdInr
    } else if (h.currency === 'INR') {
      total += h.dayPnl
    }
    // Other currencies (SGD, etc.) would need their rates; for now only INR/USD
  }
  return total
}

function MoverSection({
  label,
  holdings,
  masked,
}: {
  label: string
  holdings: LiveDayMover[]
  masked: boolean
}) {
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {holdings.length > 0 ? (
        <ul className="mt-1 space-y-1" aria-label={label}>
          {holdings.map((holding) => (
            <li key={holding.ticker} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{holding.ticker}</span>
              <span className={cn('shrink-0 font-medium tabular-nums', holding.dayChangePct > 0 ? 'text-gain' : 'text-loss')}>
                {formatPct(holding.dayChangePct)}{' '}
                <span className="text-muted-foreground">({masked ? MASK_TEXT : formatHoldingDayPnl(holding)})</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">no live day data yet</p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Market Status Badge                                                 */
/* ------------------------------------------------------------------ */

function MarketStatusBadge() {
  const [, setTick] = useState(0)

  // Update countdown every minute
  useEffect(() => {
    const interval = window.setInterval(() => setTick(t => t + 1), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  // Recompute with current time on each tick
  const currentActiveMarket = getActiveMarketLabel()
  const currentMsUntilOpen = msUntilNextMarketOpen()

  if (currentActiveMarket) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-gain" aria-live="polite">
        <Globe className="size-3" />
        {currentActiveMarket} open
      </span>
    )
  }

  if (currentMsUntilOpen > 0) {
    const hours = Math.floor(currentMsUntilOpen / (60 * 60 * 1000))
    const mins = Math.floor((currentMsUntilOpen % (60 * 60 * 1000)) / (60 * 1000))
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground" aria-live="polite">
        <Clock className="size-3" />
        Opens in {timeStr}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground" aria-live="polite">
      <Clock className="size-3" />
      Markets closed
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

const LIVE_POLL_INTERVAL_MS = 60_000

export function TodayPanel({
  latest,
  alerts,
}: {
  latest: Latest
  alerts: Alerts | undefined
}) {
  const { masked } = usePrivacy()
  const [liveLatest, setLiveLatest] = useState<Latest | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [pollError, setPollError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Determine the effective latest data (base + live overlay)
  const effectiveLatest = liveLatest ?? latest

  // Derived from effective data
  const delta = effectiveLatest.totals.dayPnl
  const animatedDelta = useAnimatedNumber(delta)
  const mover = topMover(effectiveLatest)
  const { gainers, losers } = dayMovers(effectiveLatest)
  const alertCount = alerts?.alerts.length ?? 0
  const legs = Object.entries(effectiveLatest.totals.dayPnlByAccountCurrency)
  const platformPnl = platformDayPnl(effectiveLatest)
  const breakdown = useMemo(() => dayPnlBreakdown(effectiveLatest), [effectiveLatest])

  // Use breakdown.total as the single source of truth for day P&L (matches breakdown card)
  const dayPnlTotal = breakdown?.total ?? delta
  const dayPnlDirection = dayPnlTotal > 0 ? 'Up' : dayPnlTotal < 0 ? 'Down' : 'Flat'
  const settled = Math.abs(animatedDelta - dayPnlTotal) < 0.5
  const [breakdownOpen, setBreakdownOpen] = useState(false)

  // Live polling effect
  useEffect(() => {
    const startPolling = async () => {
      if (!isMarketHoursNow()) return
      if (document.visibilityState !== 'visible') return

      setIsPolling(true)
      setPollError(null)

      const doPoll = async () => {
        try {
          abortRef.current = new AbortController()
          const live = await livePoll()
          const merged = mergeLiveIntoLatest(latest, live.holdings, live.asOf)
          // Recompute dayPnlByAccountCurrency AND consolidated dayPnl from merged holdings
          const mergedWithRecalc: Latest = {
            ...merged,
            totals: {
              ...merged.totals,
              dayPnl: recomputeConsolidatedDayPnl(merged.holdings, latest.fx.USDINR),
              dayPnlByAccountCurrency: recomputeDayPnlByCurrency(merged.holdings),
            },
          }
          setLiveLatest(mergedWithRecalc)
          setPollError(null)
        } catch (err) {
          setPollError(err instanceof Error ? err.message : 'Live poll failed')
        }
      }

      // Initial poll immediately
      await doPoll()

      // Then interval
      intervalRef.current = window.setInterval(doPoll, LIVE_POLL_INTERVAL_MS)
    }

    const stopPolling = () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
      setIsPolling(false)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isMarketHoursNow()) {
        startPolling()
      } else {
        stopPolling()
      }
    }

    // Start if conditions met
    if (isMarketHoursNow() && document.visibilityState === 'visible') {
      startPolling()
    }

    // Listen for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Check market hours periodically (every minute) to start/stop automatically
    const marketCheckInterval = window.setInterval(() => {
      if (isMarketHoursNow() && document.visibilityState === 'visible') {
        if (!isPolling) startPolling()
      } else {
        stopPolling()
      }
    }, 60_000)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(marketCheckInterval)
    }
  }, [latest, isPolling])

  // Update live data when base latest changes (e.g. after refresh)
  useEffect(() => {
    if (liveLatest) {
      // Re-merge with new base data
      const merged = mergeLiveIntoLatest(latest, liveLatest.holdings, liveLatest.asOf)
      const mergedWithRecalc: Latest = {
        ...merged,
        totals: {
          ...merged.totals,
          dayPnl: recomputeConsolidatedDayPnl(merged.holdings, latest.fx.USDINR),
          dayPnlByAccountCurrency: recomputeDayPnlByCurrency(merged.holdings),
        },
      }
      setLiveLatest(mergedWithRecalc)
    }
  }, [latest])

  return (
    <>
      <Card>
        <CardContent className="p-4">
<div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Today</h3>
            <div className="flex items-center gap-2">
              {isPolling && (
                <span className="flex items-center gap-1 text-[10px] text-gain" aria-live="polite">
                  <Activity className="size-3 animate-pulse" /> Live
                </span>
              )}
              {!isPolling && (
                <MarketStatusBadge />
              )}
              {pollError && !isPolling && (
                <span className="flex items-center gap-1 text-[10px] text-loss" aria-live="polite">
                  Live error
                </span>
              )}
              <span className="text-[11px] text-muted-foreground">{formatAsOf(effectiveLatest.asOf)}</span>
            </div>
          </div>

          <p className="mt-2 text-sm text-muted-foreground">
          {dayPnlDirection}{' '}
          <button
            type="button"
            onClick={() => setBreakdownOpen(true)}
            aria-label="Show day P&L breakdown"
            className={cn(
              'font-semibold tabular-nums transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer',
              dayPnlTotal > 0 ? 'text-gain' : dayPnlTotal < 0 ? 'text-loss' : 'text-foreground',
            )}
          >
            {masked ? MASK_TEXT : formatInrCompact(Math.abs(dayPnlTotal))}
          </button>{' '}
          <span className="text-muted-foreground/70">today</span>
          <span className="sr-only" aria-live="polite">
            {settled
              ? `${dayPnlDirection} ${masked ? 'hidden amount' : formatInrCompact(Math.abs(dayPnlTotal))} today`
              : ''}
          </span>
        </p>

        <>
          <div className="mt-3 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <p
                className="text-[11px] text-muted-foreground"
                aria-label="Day P&L classified by platform within each display currency"
              >
                By leg · by platform
              </p>
              <button
                type="button"
                onClick={() => setBreakdownOpen(true)}
                aria-label="Show day P&L breakdown"
                className="rounded-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer text-[11px]"
              >
                Breakdown
              </button>
            </div>
            <ul className="mt-1 space-y-1">
              {legs.map(([ccy, value]) => {
                const platforms = platformPnl.get(ccy)
                const hasSinglePlatform = platforms?.size === 1
                return (
                  <li key={ccy}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{legLabel(ccy)}</span>
                      {!hasSinglePlatform && (
                        <span
                          className={cn(
                            'font-medium tabular-nums',
                            value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : 'text-muted-foreground',
                          )}
                        >
                          {masked ? MASK_TEXT : formatLegValue(ccy, value)}
                        </span>
                      )}
                    </div>
                    {platforms && platforms.size > 0 && (
                      <ul className="ml-3 mt-1 space-y-1 border-l border-border pl-3" aria-label={`${legLabel(ccy)} by platform`}>
                        {[...platforms.entries()].map(([platform, platformValue]) => (
                          <li key={platform} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{platformLabel(platform)}</span>
                            <span
                              className={cn(
                                'font-medium tabular-nums',
                                platformValue > 0 ? 'text-gain' : platformValue < 0 ? 'text-loss' : 'text-muted-foreground',
                              )}
                            >
                              {masked ? MASK_TEXT : formatLegValue(ccy, platformValue)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
            {breakdown ? (
              <div className="mt-2 border-l border-border pl-3" aria-label="Native currency to INR day P&L calculation">
                <p className="text-[11px] text-muted-foreground">Native currency → INR</p>
                <ul className="mt-1 space-y-1">
                  {breakdown.platforms.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-muted-foreground">{platformLabel(row.platform)}</span>
                      <span
                        className={cn(
                          'text-right font-medium tabular-nums',
                          row.basePnl > 0 ? 'text-gain' : row.basePnl < 0 ? 'text-loss' : 'text-muted-foreground',
                        )}
                        aria-label={`${platformLabel(row.platform)} day P&L converted to INR`}
                      >
                        {masked ? MASK_TEXT : row.currency === 'INR'
                          ? `${formatNativePnl(row.nativePnl, row.currency)} (INR) = ${formatInrPrecise(row.basePnl)}`
                          : `${formatNativePnl(row.nativePnl, row.currency)} ${row.currency} × ${row.fxRate.toFixed(2)} = ${formatInrPrecise(row.basePnl)}`}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 border-t border-border pt-1 text-right text-xs font-semibold tabular-nums">
                  Total day P&L = {masked ? MASK_TEXT : formatInrPrecise(breakdown.total)}
                </p>
              </div>
            ) : (
              <p className="mt-2 border-l border-border pl-3 text-xs text-muted-foreground">
                No native FX breakdown available
              </p>
            )}
          </div>
        </>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <MoveUpRight className="size-3" /> Top mover
          </span>
          {mover ? (
            <span className="text-xs font-medium">
              {mover.ticker}{' '}
              <span
                className={cn(
                  'tabular-nums',
                  mover.pct >= 0 ? 'text-gain' : 'text-loss',
                )}
              >
                {formatPct(mover.pct)}
                {' '}
                <span className="text-muted-foreground">
                  ({masked ? MASK_TEXT : formatHoldingDayPnl(mover.holding)})
                </span>
              </span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">no live day data yet</span>
          )}
        </div>

        <MoverSection label="Top gainers" holdings={gainers} masked={masked} />
        <MoverSection label="Top losers" holdings={losers} masked={masked} />

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <BellRing className="size-3" /> Alerts today
          </span>
          <Badge variant={alertCount > 0 ? 'warning' : 'secondary'}>{alertCount}</Badge>
        </div>
      </CardContent>
    </Card>
      <DayPnlBreakdownDialog latest={effectiveLatest} open={breakdownOpen} onOpenChange={setBreakdownOpen} />
    </>
  )
}
