/**
 * Header status row: "as of" label, per-platform staleness badges, alerts
 * count chip, Refresh-now button and the Chat toggle.
 *
 * Refresh-now is the ONLY write-ish path in the UI: it POSTs to the bridge,
 * which shells out to the real pipeline (snapshot + export). Rendering stays
 * deterministic — this just regenerates the deterministic inputs.
 */

import { AlertCircle, RefreshCw, MessageSquare } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Spinner } from '@/components/layout/states'
import { useRefresh } from '@/lib/useRefresh'
import { useBackendHealth, type BackendStatus } from '@/lib/useBackendHealth'
import { formatAsOfLong, platformLabel } from '@/lib/format'
import type { Latest, Alerts } from '@/types/contract'
import { cn } from '@/lib/utils'

const STALE_THRESHOLD_DISPLAY = 'stale'

export function StatusBar({
  latest,
  alerts,
  onChatToggle,
  chatOpen,
}: {
  latest: Latest | undefined
  alerts: Alerts | undefined
  onChatToggle: () => void
  chatOpen: boolean
}) {
  const { state, run } = useRefresh()
  const [flash, setFlash] = useState<'ok' | 'error' | null>(null)

  const stalePlatforms = Object.entries(latest?.platforms ?? {}).filter(
    ([, p]) => p.stale,
  )
  const alertCount = alerts?.alerts.length ?? 0
  const criticalCount = alerts?.alerts.filter((a) => a.severity === 'critical').length ?? 0

  async function handleRefresh() {
    const outcome = await run()
    setFlash(outcome === 'done' ? 'ok' : 'error')
    if (outcome === 'done' || outcome === 'error') {
      window.setTimeout(() => setFlash(null), 4000)
    }
  }

  const refreshing = state.status === 'running'

  // Backend liveness: bridge + opencode serve. Polls /api/health (see hook).
  const backend = useBackendHealth()
  const backendLabel: Record<BackendStatus, string> = {
    loading: 'Connecting…',
    online: 'Agent online',
    'agent-offline': 'Agent offline',
    'backend-offline': 'Backend offline',
  }
  const backendDot: Record<BackendStatus, string> = {
    loading: 'bg-muted-foreground',
    online: 'bg-gain',
    'agent-offline': 'bg-warning',
    'backend-offline': 'bg-loss',
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 text-xs">
      <span className="text-muted-foreground">
        As of <span className="text-foreground">{formatAsOfLong(latest?.asOf)}</span>
        <span className="ml-1 text-muted-foreground/70">
          ({latest?.baseCurrency ?? 'INR'} base)
        </span>
      </span>

      {stalePlatforms.length > 0 && (
        <span className="flex items-center gap-1.5">
          {stalePlatforms.map(([name, p]) => (
            <Tooltip key={name}>
              <TooltipTrigger asChild>
                <Badge variant="warning" className="cursor-help">
                  <AlertCircle className="size-3" />
                  {platformLabel(name)} {STALE_THRESHOLD_DISPLAY}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                Last update {formatAsOfLong(p.asOf)} — pipeline not run since
              </TooltipContent>
            </Tooltip>
          ))}
        </span>
      )}

      {alertCount > 0 && (
        <Badge variant={criticalCount > 0 ? 'danger' : 'warning'} className="gap-1">
          <AlertCircle className="size-3" />
          {alertCount} alert{alertCount === 1 ? '' : 's'}
        </Badge>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className={cn('size-2 rounded-full', backendDot[backend])} />
              {backendLabel[backend]}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {backend === 'backend-offline'
              ? 'Backend bridge (127.0.0.1:8000) is down — start the stack with `npm run dev:stack`.'
              : backend === 'agent-offline'
                ? 'opencode serve is down — start it with `opencode serve --port 4096`.'
                : backend === 'online'
                  ? 'Agent runtime (opencode serve) is reachable.'
                  : 'Checking backend status…'}
          </TooltipContent>
        </Tooltip>
        {state.status === 'error' && flash === 'error' && (
          <span className="max-w-60 truncate text-loss">Refresh failed: {state.detail}</span>
        )}
        {state.status === 'done' && flash === 'ok' && (
          <span className="max-w-60 truncate text-gain">Refreshed: {state.detail}</span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh now"
            >
              {refreshing ? <Spinner /> : <RefreshCw className="size-3.5" />}
              {refreshing ? 'Refreshing…' : 'Refresh now'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Run snapshot --all --force + export (live broker pull via the bridge)
          </TooltipContent>
        </Tooltip>
        <Button
          variant={chatOpen ? 'secondary' : 'ghost'}
          size="sm"
          onClick={onChatToggle}
          aria-label="Toggle chat"
        >
          <MessageSquare className={cn('size-3.5', !chatOpen && 'text-muted-foreground')} />
          Chat
        </Button>
      </div>
    </div>
  )
}