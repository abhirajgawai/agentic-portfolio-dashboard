/**
 * src/components/layout/HealthTicker.tsx — Footer status bar.
 * Three sections: [Timestamp] · [Platform freshness pills] · [FX · NAV · Runs].
 * role="status", aria-live="polite".
 *
 * The Timestamp section shows the data `asOf` (from the latest.json export).
 * The live "last refresh" stamp with date+year lives in the Header (next to the
 * Refresh button) — see RefreshNotice useBackendHealth; this footer stays a
 * compact data-timestamp + staleness summary.
 */

import { AlertCircle, Bot, Clock, Activity } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useLatest } from '@/lib/data'
import { useBackendHealth } from '@/lib/useBackendHealth'
import { formatAsOf, formatAsOfLong, formatAsOfLongSGT } from '@/lib/format'

const STALE_THRESHOLD_DAYS = 2 // brokers; 35 for CAS

export function HealthTicker() {
  const latest = useLatest()
  const data = latest.data
  const health = useBackendHealth()

  // Compute per-platform freshness — skip real_estate (manual valuation, not refreshed daily)
  const platformFreshness = Object.entries(data?.platforms ?? {})
    .filter(([name]) => name !== 'real_estate')
    .map(([name, p]) => {
      const asOf = p.asOf ? new Date(p.asOf) : null
      const now = new Date()
      const daysPast = asOf ? Math.max(0, Math.floor((now.getTime() - asOf.getTime()) / 86400000)) : null
      const isStale = daysPast !== null && daysPast >= STALE_THRESHOLD_DAYS
      const dotClass = isStale ? 'bg-amber' : 'bg-gain'
      const dotAria = isStale
        ? `${name} stale — ${daysPast}d past threshold`
        : `${name} fresh — as of ${formatAsOf(p.asOf)}`
      return { name, asOf, daysPast, isStale, dotClass, dotAria }
    },
  )

  const fxRate = data?.fx?.USDINR ?? null
  const navCount = (data?.holdings ?? []).filter(
    (h) => h.assetClass === 'mutual_fund' || h.assetClass === 'etf',
  ).length
  const runsOk = Boolean(data?.asOf)

  // Agent status pill — reflects the bridge health poll. 'backend-offline' is
  // deliberately a DISTINCT label from 'agent offline' so the user can tell
  // whether opencode serve or the bridge itself (:8000) is down.
  const agentPill =
    health.status === 'online'
      ? {
          label: 'agent online',
          color: 'text-gain',
          dot: 'bg-gain',
          tip: 'Analyst agent online — ask questions in the chat panel.',
        }
      : health.status === 'agent-offline'
        ? {
            label: 'agent offline',
            color: 'text-loss',
            dot: 'bg-loss',
            tip: 'Analyst agent offline — opening the chat panel starts it automatically.',
          }
        : health.status === 'backend-offline'
          ? {
              label: 'bridge down',
              color: 'text-muted-foreground',
              dot: 'bg-muted-foreground/50',
              tip: 'Bridge (localhost:8000) unreachable — agent status unknown until it is back.',
            }
          : {
              label: 'agent …',
              color: 'text-muted-foreground',
              dot: 'bg-muted-foreground/60',
              tip: 'Checking agent status…',
            }

  return (
    <footer
      className="flex items-center gap-x-4 gap-y-1 border-t bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground overflow-hidden"
      role="status"
      aria-live="polite"
    >
      {/* ==== LAST REFRESH (live export stamp, dual timezone) ==== */}
      <span className="flex items-center gap-1.5 shrink-0">
        <Clock className="size-3 opacity-50" />
        {health.exportsGeneratedAt ? (
          <>
            <span>Last refresh {formatAsOfLong(health.exportsGeneratedAt)} IST</span>
            <span className="text-muted-foreground/50">·</span>
            <span>{formatAsOfLongSGT(health.exportsGeneratedAt)} SGT</span>
          </>
        ) : (
          <span title="Dashboard data timestamp (export run time)">{formatAsOf(data?.asOf)}</span>
        )}
        <span className="text-muted-foreground/50">{data?.baseCurrency ?? 'INR'}</span>
      </span>

      {/* ==== DIVIDER ==== */}
      <div className="w-px h-3.5 bg-border/50 shrink-0" />

      {/* ==== PLATFORM FRESHNESS PILLS ==== */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {platformFreshness.map((p) => (
          <Tooltip key={p.name}>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium transition-colors',
                  p.isStale
                    ? 'bg-warning/15 text-warning'
                    : 'bg-gain/10 text-gain',
                )}
              >
                <span className={cn('size-1.5 rounded-full shrink-0', p.dotClass)} />
                <span className="capitalize">{p.name}</span>
                {p.isStale && p.daysPast !== null && (
                  <span className="text-[10px] opacity-70">{p.daysPast}d</span>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent className="py-1 text-xs">
              {p.dotAria}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* ==== DIVIDER ==== */}
      <div className="w-px h-3.5 bg-border/50 shrink-0 hidden sm:block" />

      {/* ==== STATS ==== */}
      <div className="flex items-center gap-3 ml-auto shrink-0">
        {/* Agent status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1.5">
              <Bot className={cn('size-3', agentPill.color)} />
              <span className={cn('size-1.5 rounded-full shrink-0', agentPill.dot)} />
              <span className={cn(agentPill.color)}>{agentPill.label}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent className="py-1 text-xs">{agentPill.tip}</TooltipContent>
        </Tooltip>

        {/* FX rate */}
        {fxRate !== null && (
          <span className="tabular-nums">
            <span className="text-muted-foreground/50">FX</span>{' '}
            <span className="font-medium text-foreground/80">USD/INR {fxRate.toFixed(2)}</span>
          </span>
        )}

        {/* NAV count */}
        {navCount > 0 && (
          <span className="tabular-nums">
            <span className="text-muted-foreground/50">NAV</span>{' '}
            <span className="font-medium text-foreground/80">{navCount}</span>
          </span>
        )}

        {/* Runs status */}
        <span className="flex items-center gap-1.5">
          <Activity className={cn('size-3', runsOk ? 'text-gain' : 'text-loss')} />
          <span className={cn(runsOk ? 'text-gain' : 'text-loss font-medium')}>
            {runsOk ? 'ok' : 'no data'}
          </span>
          {!runsOk && <AlertCircle className="size-3 text-loss" />}
        </span>
      </div>
    </footer>
  )
}
