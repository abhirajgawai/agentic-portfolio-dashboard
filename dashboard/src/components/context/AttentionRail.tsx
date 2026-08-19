/**
 * src/components/context/AttentionRail.tsx — Right-rail stack of attention
 * cards: fired alerts (alerts.json), stale platforms (latest.json platforms
 * asOf vs threshold), and biggest single-day movers (history.json deltas).
 * Calm "All caught up" empty state. Pure read of the contract via lib/data
 * hooks — no bridge, no agent, no undefined vars.
 */

import { useMemo } from 'react'
import { AlertCircle, Bell, TrendingUp } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useAlerts, useHistory, useLatest } from '@/lib/data'
import { platformLabel } from '@/lib/format'
import type { Alert } from '@/types/contract'

const SEVERITY_STYLES: Record<Alert['severity'], string> = {
  info: 'bg-primary/10 text-primary',
  warn: 'bg-amber/10 text-amber',
  critical: 'bg-loss/15 text-loss',
}

export function AttentionRail() {
  const latest = useLatest()
  const alerts = useAlerts()
  const history = useHistory()

  // Per-platform staleness (days past the broker threshold of 2d; CAS platforms
  // are handled by their own threshold but we keep one simple broker rule here).
  const stalePlatforms = useMemo(() => {
    const platforms = latest.data?.platforms ?? {}
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
  }, [latest.data])

  // Biggest single-day movers from history.json.
  const biggestMovers = useMemo(() => {
    const dates = history.data?.dates ?? []
    const values = history.data?.portfolioValueBase ?? []
    const changes: Array<{ date: string; pct: number }> = []
    for (let i = 1; i < dates.length; i++) {
      const prev = values[i - 1]
      const curr = values[i]
      if (prev === undefined || curr === undefined || prev === 0) continue
      changes.push({ date: dates[i] ?? '', pct: ((curr - prev) / prev) * 100 })
    }
    changes.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    return changes.slice(0, 3)
  }, [history.data])

  const fired = alerts.data?.alerts ?? []
  const allCaughtUp = fired.length === 0 && stalePlatforms.length === 0 && biggestMovers.length === 0

  return (
    <div className="space-y-3" aria-label="Attention rail">
      {/* Fired alerts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xs text-muted-foreground">
            <Bell className="size-3.5" /> Alerts
            {fired.length > 0 && (
              <Badge variant="outline" className="ml-auto px-1.5 text-[10px]">
                {fired.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {fired.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No fired rules — all quiet.</p>
          ) : (
            fired.slice(0, 4).map((a, i) => (
              <div
                key={`${a.ruleId}-${i}`}
                className={cn('flex items-start gap-2 rounded-md px-2 py-1.5 text-[11px]', SEVERITY_STYLES[a.severity] ?? '')}
              >
                <AlertCircle className="mt-0.5 size-3 shrink-0" />
                <span>{a.message}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Stale platforms */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUp className="size-3.5" /> Freshness
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {stalePlatforms.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">All platforms fresh.</p>
          ) : (
            stalePlatforms.map((p) => (
              <div key={p.name} className="flex items-center justify-between gap-2 rounded-md bg-amber/10 px-2 py-1.5 text-[11px] text-amber">
                <span>{platformLabel(p.name)}</span>
                <span className="tabular-nums">{p.daysPast}d stale</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Biggest movers */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUp className="size-3.5" /> Biggest moves
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {biggestMovers.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Not enough history yet.</p>
          ) : (
            biggestMovers.map((m) => (
              <div key={m.date} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px]">
                <span className="tabular-nums">{m.date.slice(5)}</span>
                <span className={cn('tabular-nums font-medium', m.pct >= 0 ? 'text-gain' : 'text-loss')}>
                  {m.pct > 0 ? '+' : ''}{m.pct.toFixed(1)}%
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Calm empty state */}
      {allCaughtUp && (
        <p className="px-2 py-1 text-center text-[11px] text-muted-foreground">
          All caught up ✓
        </p>
      )}
    </div>
  )
}
