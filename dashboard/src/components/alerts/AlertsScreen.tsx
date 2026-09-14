/** Alerts screen — the single home for everything that "needs my attention"
 *  (Ledger Gold redesign §3.4,
 *  docs/superpowers/specs/2026-09-12-ledger-gold-redesign-design.md). Two
 *  sections:
 *   - Data freshness: the full per-source staleness detail that Journey's
 *     StalenessBanner used to render inline before Task 1 condensed it to a
 *     chip that deep-links here (§3.1) — same derivation, imported from
 *     `journey/staleness.ts` rather than reimplemented, so the chip and this
 *     list can never drift.
 *   - Fired alerts: the rule evaluation log (M6) with severity colors and a
 *     clear empty state. Read-only today; rule toggles are a designed-for
 *     M8.5 future (a deliberate WRITE path that must go through the bridge,
 *     never the UI straight into rules.yaml). */

import { BellOff, CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '@/components/layout/states'
import { PageHeader } from '@/components/layout/PageHeader'
import { buildStalenessBuckets, type StalenessBucket } from '@/components/journey/staleness'
import { formatAsOf, formatAsOfLong } from '@/lib/format'
import { useAlerts, useLatest } from '@/lib/data'
import type { Alert } from '@/types/contract'

const SEVERITY_BADGE = {
  info: 'secondary',
  warn: 'warning',
  critical: 'danger',
} as const

const SEVERITY_ICON = {
  info: ShieldCheck,
  warn: ShieldAlert,
  critical: ShieldAlert,
} as const

function AlertRow({ alert }: { alert: Alert }) {
  const Icon = SEVERITY_ICON[alert.severity]
  return (
    <li className="flex items-start gap-3 border-b border-border/50 px-4 py-3 transition-colors last:border-0 hover:bg-accent/40">
      <Icon
        className={
          alert.severity === 'critical'
            ? 'mt-0.5 size-4 shrink-0 text-loss'
            : alert.severity === 'warn'
              ? 'mt-0.5 size-4 shrink-0 text-warning'
              : 'mt-0.5 size-4 shrink-0 text-muted-foreground'
        }
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{alert.ruleId}</span>
          <Badge variant={SEVERITY_BADGE[alert.severity]} className="capitalize">
            {alert.severity}
          </Badge>
        </div>
        <p className="mt-1 text-sm">{alert.message}</p>
      </div>
    </li>
  )
}

/** One "Data freshness" row — source name, last-updated timestamp, and (when
 *  stale) the same action hint the Journey chip's tooltip used to carry
 *  inline. Fresh sources still get a row (with a check icon) so this reads as
 *  a complete status list, not just a list of problems. */
function FreshnessRow({ bucket }: { bucket: StalenessBucket }) {
  return (
    <li className="flex items-start gap-3 border-b border-border/50 px-4 py-3 transition-colors last:border-0 hover:bg-accent/40">
      {bucket.stale ? (
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-gain" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{bucket.label}</span>
          <Badge variant={bucket.stale ? 'warning' : 'success'}>
            {bucket.stale ? 'Stale' : 'Fresh'}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Last updated {formatAsOf(bucket.asOf)}
          {bucket.stale && <> · {bucket.hint}</>}
        </p>
      </div>
    </li>
  )
}

function DataFreshnessSection() {
  const latest = useLatest()

  if (latest.isLoading) return <LoadingState label="Loading data freshness…" />
  if (latest.isError) {
    return (
      <ErrorState
        message={latest.error instanceof Error ? latest.error.message : String(latest.error)}
        onRetry={() => void latest.refetch()}
      />
    )
  }
  if (!latest.data) return null

  const buckets = buildStalenessBuckets(latest.data, new Date())
  const staleCount = buckets.filter((b) => b.stale).length

  return (
    <Card>
      <CardHeader className="flex-col gap-2 pb-1 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-xs text-muted-foreground">
          Data freshness · as of {formatAsOfLong(latest.data.asOf)}
        </CardTitle>
        {staleCount > 0 ? (
          <Badge variant="warning">
            {staleCount} source{staleCount === 1 ? '' : 's'} need attention
          </Badge>
        ) : (
          <Badge variant="success">All sources fresh</Badge>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y-0">
          {buckets.map((bucket) => (
            <FreshnessRow key={bucket.key} bucket={bucket} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function FiredAlertsSection() {
  const alerts = useAlerts()

  if (alerts.isLoading) return <LoadingState label="Loading alerts…" />
  if (alerts.isError) {
    return (
      <ErrorState
        message={alerts.error instanceof Error ? alerts.error.message : String(alerts.error)}
        onRetry={() => void alerts.refetch()}
      />
    )
  }
  if (!alerts.data) return null

  const fired = alerts.data.alerts
  const bySeverity = {
    info: fired.filter((a) => a.severity === 'info').length,
    warn: fired.filter((a) => a.severity === 'warn').length,
    critical: fired.filter((a) => a.severity === 'critical').length,
  }

  return (
    <Card>
      <CardHeader className="flex-col gap-2 pb-1 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-xs text-muted-foreground">
          Fired alerts · evaluated {formatAsOfLong(alerts.data.generatedAt)}
        </CardTitle>
        <div className="flex flex-wrap gap-1.5">
          {bySeverity.critical > 0 && (
            <Badge variant="danger">{bySeverity.critical} critical</Badge>
          )}
          {bySeverity.warn > 0 && <Badge variant="warning">{bySeverity.warn} warn</Badge>}
          {bySeverity.info > 0 && (
            <Badge variant="secondary">{bySeverity.info} info</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {fired.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title="No alerts fired"
            description="Rule evaluation ran clean — nothing crossed a threshold on the last export. Rules live in data/rules.yaml (thresholds, ops, severities)."
          />
        ) : (
          <ul className="divide-y-0">
            {fired.map((alert) => (
              <AlertRow key={`${alert.ruleId}:${alert.message}`} alert={alert} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function AlertsScreen() {
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Alerts"
        subtitle="Everything that needs your attention — stale data sources, plus rule evaluation results from the last export (thresholds, ops, severities live in data/rules.yaml)."
      />
      <DataFreshnessSection />
      <FiredAlertsSection />
    </div>
  )
}
