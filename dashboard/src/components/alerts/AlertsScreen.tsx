/** Alerts screen — the fired-rules log (M6) with severity colors and a clear
 *  empty state. Read-only today; rule toggles are a designed-for M8.5 future
 *  (a deliberate WRITE path that must go through the bridge, never the UI
 *  straight into rules.yaml). */

import { BellOff, ShieldAlert, ShieldCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '@/components/layout/states'
import { formatAsOfLong } from '@/lib/format'
import { useAlerts } from '@/lib/data'
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
    <li className="flex items-start gap-3 border-b border-border/50 px-4 py-3 last:border-0">
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
        <div className="flex items-center gap-2">
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

export function AlertsScreen() {
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
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex-row items-center justify-between pb-1">
          <CardTitle className="text-xs text-muted-foreground">
            Fired alerts · evaluated {formatAsOfLong(alerts.data.generatedAt)}
          </CardTitle>
          <div className="flex gap-1.5">
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
    </div>
  )
}