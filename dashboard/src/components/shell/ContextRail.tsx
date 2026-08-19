/**
 * src/components/shell/ContextRail.tsx — Right pane (256px, collapsible).
 * Contains:
 *   - Alerts: fired rules from alerts.json with severity colors.
 *   - Data freshness: only actionable staleness (threshold exceeded).
 *   - Top movers: per-holding day P&L from performance.json.
 *
 * Allocation donuts moved to their own Allocation tab — no longer duplicated here.
 *
 * Mobile (< 768px): renders as a bottom sheet (slide up from bottom) when isOpen=true,
 * with backdrop + drag handle. Desktop: renders as a flex child (no overlay).
 */

import { useMemo } from 'react'
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle,
  Info,
  ChevronLeft,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { useLatest, useHistory, useAlerts, usePerformance } from '@/lib/data'
import { formatInrCompact, platformLabel } from '@/lib/format'
import type { Alert } from '@/types/contract'
import { useMediaQuery } from '@/lib/use-media-query'

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

interface ContextRailProps {
  isCollapsed?: boolean
  /** Mobile overlay open state (ignored on desktop) */
  isOpen?: boolean
  /** Called when the mobile overlay should close */
  onClose?: () => void
}

/* ------------------------------------------------------------------ */
/* Alert severity styles                                               */
/* ------------------------------------------------------------------ */

const SEVERITY_STYLES: Record<Alert['severity'], { icon: typeof AlertCircle; className: string }> = {
  warn: { icon: AlertCircle, className: 'text-warning bg-warning/10' },
  critical: { icon: AlertCircle, className: 'text-loss bg-loss/10' },
  info: { icon: Info, className: 'text-muted-foreground bg-muted/50' },
}

/* ------------------------------------------------------------------ */
/* ContextRail                                                         */
/* ------------------------------------------------------------------ */

export function ContextRail({ isCollapsed, isOpen = true, onClose }: ContextRailProps) {
  const isMobile = useMediaQuery('(max-width: 767px)')
  const latest = useLatest()
  const history = useHistory()
  const alertsHook = useAlerts()
  const perf = usePerformance()
  const data = latest.data

  /* ---- Alerts ---- */
  const fired = alertsHook.data?.alerts ?? []

  /* ---- Staleness (useMemo keyed on data, no new Date() in render) ---- */
  const stalePlatforms = useMemo(() => {
    const platforms = data?.platforms ?? {}
    const now = Date.now()
    const out: Array<{ name: string; daysPast: number }> = []
    for (const [name, p] of Object.entries(platforms)) {
      if (!p?.asOf || !p?.stale) continue
      const asOfMs = new Date(p.asOf).getTime()
      if (Number.isNaN(asOfMs)) continue
      const daysPast = Math.max(0, Math.floor((now - asOfMs) / 86_400_000))
      out.push({ name, daysPast })
    }
    return out.sort((a, b) => b.daysPast - a.daysPast)
  }, [data?.platforms])

  /* ---- Top movers from performance.json ---- */
  interface Mover {
    ticker: string
    name: string | null
    dayPnlBase: number
    valueBase: number
  }

  const topMovers: Mover[] = useMemo(() => {
    const daily = perf.data?.daily
    if (!daily || daily.length === 0) return []
    const latest = daily[daily.length - 1]
    return (latest?.topMovers ?? []).slice(0, 3)
  }, [perf.data])

  /* ---- Portfolio trend fallback (when no performance data) ---- */
  const portfolioTrend = useMemo(() => {
    if (topMovers.length > 0) return [] // performance data takes priority
    const dates = history.data?.dates
    const values = history.data?.portfolioValueBase
    if (!dates?.length || !values?.length) return []
    const changes: Array<{ date: string; pct: number }> = []
    for (let i = 1; i < dates.length; i++) {
      const prev = values[i - 1]
      const curr = values[i]
      if (prev === undefined || curr === undefined || prev === 0) continue
      changes.push({ date: dates[i] ?? '', pct: ((curr - prev) / prev) * 100 })
    }
    changes.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    return changes.slice(0, 3)
  }, [history.data, topMovers.length])

  /* ---- Empty states ---- */
  const hasAlerts = fired.length > 0
  const hasStale = stalePlatforms.length > 0
  const hasMovers = topMovers.length > 0 || portfolioTrend.length > 0
  const allCaughtUp = !hasAlerts && !hasStale && !hasMovers

  // ---- Mobile bottom sheet ----
  if (isMobile && isOpen) {
    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50 z-modal"
          onClick={onClose}
          aria-hidden="true"
        />
        {/* Sheet */}
        <div className="fixed bottom-0 left-0 right-0 z-modal bg-sidebar border-t border-border rounded-t-xl max-h-[50vh] overflow-y-auto transform transition-transform duration-250 ease-out">
          {/* Drag handle */}
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between h-10 px-3 border-b border-border">
            <h2 className="text-xs font-semibold text-foreground">Context</h2>
            <button
              type="button"
              className="p-1 rounded hover:bg-accent/20 text-muted-foreground hover:text-foreground transition-colors"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Content: Alerts + Staleness */}
          <div className="px-3 py-3 space-y-3">
            {/* Alerts */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Alerts
                </span>
                {hasAlerts && (
                  <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-primary/15 text-primary text-[9px] font-semibold tabular-nums">
                    {fired.length}
                  </span>
                )}
              </div>
              {hasAlerts ? (
                <div className="space-y-1.5">
                  {fired.slice(0, 3).map((a, i) => {
                    const sev = SEVERITY_STYLES[a.severity] ?? SEVERITY_STYLES.info
                    const Icon = sev.icon
                    return (
                      <div
                        key={`${a.ruleId}-${i}`}
                        className={cn(
                          'flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px]',
                          sev.className,
                        )}
                      >
                        <Icon className="mt-0.5 size-3 shrink-0" />
                        <div className="min-w-0">
                          <span className="font-medium">{a.ruleId}</span>
                          <p className="text-[10px] opacity-80 mt-0.5 leading-tight">{a.message}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <CheckCircle className="size-3" />
                  <span>All caught up</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </>
    )
  }

  // ---- Desktop: render as a flex child ----

  return (
    <div
      className={cn(
        'w-64 shrink-0 bg-sidebar border-l border-border flex flex-col h-screen',
        isCollapsed ? 'collapsed' : '',
      )}
      role="complementary"
      aria-label="Portfolio context"
    >
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between h-10 px-3 border-b border-border">
        <h2 className="text-xs font-semibold text-foreground">
          Context
        </h2>
        <button
          type="button"
          className="p-0.5 rounded hover:bg-accent/20 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Collapse sidebar"
        >
          <ChevronLeft className="size-3.5" />
        </button>
      </div>

      {/* ---- Scrollable content ---- */}
      <div className="flex-1 overflow-y-auto">
        {/* ============================================================ */}
        {/* Alerts                                                        */}
        {/* ============================================================ */}
        <div className="px-3 pt-3 pb-2 border-b border-border/30">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Alerts
            </span>
            {hasAlerts && (
              <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-primary/15 text-primary text-[9px] font-semibold tabular-nums">
                {fired.length}
              </span>
            )}
          </div>

          {hasAlerts ? (
            <div className="space-y-1.5">
              {fired.slice(0, 5).map((a, i) => {
                const sev = SEVERITY_STYLES[a.severity] ?? SEVERITY_STYLES.info
                const Icon = sev.icon
                return (
                  <div
                    key={`${a.ruleId}-${i}`}
                    className={cn(
                      'flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px]',
                      sev.className,
                    )}
                  >
                    <Icon className="mt-0.5 size-3 shrink-0" />
                    <div className="min-w-0">
                      <span className="font-medium">{a.ruleId}</span>
                      <p className="text-[10px] opacity-80 mt-0.5 leading-tight">{a.message}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CheckCircle className="size-3" />
              <span>All caught up</span>
            </div>
          )}
        </div>

        {/* ============================================================ */}
        {/* Data freshness (only actionable)                              */}
        {/* ============================================================ */}
        {hasStale && (
          <div className="px-3 pt-3 pb-2 border-b border-border/30 space-y-1.5">
            {stalePlatforms.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-1.5 rounded-md bg-warning/10 text-warning px-2 py-1.5 text-[11px]"
              >
                <AlertCircle className="size-3 shrink-0" />
                <span className="font-medium">{platformLabel(p.name)}</span>
                <span className="text-[10px] opacity-80 ml-auto tabular-nums">{p.daysPast}d stale</span>
              </div>
            ))}
          </div>
        )}

        {/* ============================================================ */}
        {/* Top movers / Portfolio trend                                   */}
        {/* ============================================================ */}
        {topMovers.length > 0 ? (
          <div className="px-3 pt-3 pb-2 border-b border-border/30">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Top movers today
            </div>
            <div className="space-y-1">
              {topMovers.map((m) => (
                <div
                  key={m.ticker}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]',
                    m.dayPnlBase >= 0
                      ? 'text-gain'
                      : 'text-loss',
                  )}
                >
                  {m.dayPnlBase >= 0
                    ? <ArrowUpRight className="size-3 shrink-0" />
                    : <ArrowDownRight className="size-3 shrink-0" />}
                  <span className="font-medium truncate">{m.ticker}</span>
                  <span className="ml-auto tabular-nums text-[10px]">
                    {m.dayPnlBase >= 0 ? '+' : ''}{formatInrCompact(m.dayPnlBase)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : portfolioTrend.length > 0 ? (
          <div className="px-3 pt-3 pb-2 border-b border-border/30">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Portfolio trend
            </div>
            <div className="space-y-1">
              {portfolioTrend.map((t) => (
                <div
                  key={t.date}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]',
                    t.pct >= 0 ? 'text-gain' : 'text-loss',
                  )}
                >
                  {t.pct >= 0
                    ? <ArrowUpRight className="size-3 shrink-0" />
                    : <ArrowDownRight className="size-3 shrink-0" />}
                  <span className="truncate">{t.date.slice(5)}</span>
                  <span className="ml-auto tabular-nums text-[10px]">
                    {t.pct > 0 ? '+' : ''}{t.pct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ============================================================ */}
        {/* All caught up (everything empty)                              */}
        {/* ============================================================ */}
        {allCaughtUp && (
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CheckCircle className="size-3" />
              <span>No alerts, all data fresh.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
