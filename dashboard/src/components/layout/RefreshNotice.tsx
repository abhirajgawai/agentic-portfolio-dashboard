/**
 * src/components/layout/RefreshNotice.tsx — "New data generated — reload" banner.
 * Mounted at the top of the shell (AppShell). Appears ONLY when the bridge
 * reports a newer export stamp (exportsGeneratedAt) than the one captured when
 * the tab mounted — i.e. the scheduled/background export regenerated the JSONs
 * while this tab was open.
 *
 * States:
 *   - initial load      baseline == current stamp  -> hidden (normal case)
 *   - bridge offline    stamp is null              -> hidden (existing states keep their handling)
 *   - loading           stamp is null              -> hidden
 *   - export advances   stamp > baseline           -> shown with Reload + dismiss
 *   - dismissed         stamp == dismissedStamp    -> hidden until a STRICTLY newer stamp
 *
 * Dismiss re-arms for the NEXT advance (the dismissed stamp becomes the hidden
 * baseline). Reload is a hard window.location.reload() so TanStack Query
 * re-reads the regenerated JSONs from disk. Deterministic — the advance check
 * is a plain ISO-string inequality (ISO 8601 UTC sorts lexicographically).
 */

import { useEffect, useState, useRef } from 'react'
import { RefreshCw, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatLocalTime } from '@/lib/format'
import type { BackendHealthState } from '@/lib/useBackendHealth'

export function RefreshNotice({
  health,
  manualRefreshCount = 0,
}: {
  health: BackendHealthState
  /**
   * Number of completed *manual* refreshes in this tab. A manual refresh
   * already invalidated the queries and updated the UI live, so the stamp it
   * produces must NOT trigger a "reload to see latest" banner. We increment
   * this counter from AppShell when `refresh.state.status === 'done'`; here it
   * arms an "absorb the next observed advance" so a manual refresh is silent
   * while genuine background (scheduled) exports still surface the banner.
   */
  manualRefreshCount?: number
}) {
  // Export stamp seen when the tab first reported a real payload.
  const [baseline, setBaseline] = useState<string | null>(null)
  // Stamp the user dismissed — hidden until a stamp strictly newer than this.
  const [dismissedStamp, setDismissedStamp] = useState<string | null>(null)
  // Refs (effect-driven): never render from them directly.
  const handledCountRef = useRef(0)
  const suppressNextRef = useRef(false)

  useEffect(() => {
    // Arm the baseline on the first real payload. StrictMode double-invokes
    // effects; the null guard makes that idempotent (and a bridge reconnect
    // reporting the same stamp keeps baseline == current -> hidden).
    if (baseline === null && health.exportsGeneratedAt !== null) {
      setBaseline(health.exportsGeneratedAt)
    }
  }, [baseline, health.exportsGeneratedAt])

  // A manual refresh (count advanced from AppShell) arms "absorb the next observed
  // export stamp change". That change is the result of the manual refresh we just
  // triggered, so it must NOT show the banner — the UI already re-fetched live via
  // useRefresh's query invalidation. (A genuine scheduled export still produces a
  // banner; only the single change right after a manual refresh is swallowed.)
  useEffect(() => {
    if (manualRefreshCount === handledCountRef.current) return
    handledCountRef.current = manualRefreshCount
    suppressNextRef.current = true
  }, [manualRefreshCount])

  const stamp = health.exportsGeneratedAt
  // Absorb the advance triggered by a manual refresh: when suppression is armed and
  // a stamp change arrives, re-baseline instead of showing. `show` reads the ref
  // directly so nothing flashes before this effect re-baselines.
  useEffect(() => {
    if (!suppressNextRef.current) return
    if (stamp === null || stamp === baseline) return
    setBaseline(stamp)
    suppressNextRef.current = false
  }, [stamp, baseline])

  const advanced =
    stamp !== null && baseline !== null && stamp !== baseline && stamp !== dismissedStamp
  const show =
    !suppressNextRef.current &&
    health.status !== 'loading' &&
    health.status !== 'backend-offline' &&
    advanced

  if (!show) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border-b bg-warning/10 px-4 py-1.5 text-xs text-warning"
    >
      <RefreshCw className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        New data generated at {formatLocalTime(stamp)} — reload to see the latest
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => window.location.reload()}
        className="h-7 shrink-0 cursor-pointer"
      >
        Reload
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setDismissedStamp(stamp)}
        className="h-7 w-7 shrink-0 cursor-pointer px-0"
        aria-label="Dismiss new data notice"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}