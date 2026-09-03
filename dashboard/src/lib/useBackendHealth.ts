/**
 * Polls the bridge's /api/health so the UI can surface backend state — the
 * local-dev stand-in for the M9 staleness monitor.
 *
 * Four states (three real, plus a transient 'loading'):
 *   - 'loading'         first poll has not resolved yet
 *   - 'online'          bridge reachable AND opencode serve reachable (agent:true)
 *   - 'agent-offline'  bridge reachable but opencode serve down (agent:false)
 *   - 'backend-offline' the bridge itself (:8001) is unreachable — the fetch threw,
 *                        i.e. `npm run dev:stack` (or the bridge) is not running.
 *
 * Health only distinguishes bridge-up/down via the fetch succeeding; an unreachable
 * bridge throws before we ever read the JSON, so we catch that as backend-offline.
 *
 * Returned state also carries the pipeline timestamps so consumers can render
 * "last refresh" (HealthTicker footer) and detect a background export advancing
 * while the tab is open (RefreshNotice reload banner):
 *   - exportsGeneratedAt — mtime of the newest export file (ISO UTC). THE reload
 *     signal: it advances only when the JSON files are actually regenerated.
 *   - asOf               — latest.json run time, the data's own timestamp.
 * Both are null while 'loading', when the bridge is unreachable (fetch threw),
 * or when the bridge reports no export/run yet. On an offline transition the
 * previous timestamps are dropped so stale stamps never linger.
 *
 * zerodhaDaemon carries the bridge's LIVE probe of the Zerodha session daemon
 * (GET :8787/health, see bridge.py's _zerodha_daemon_health) — distinct from
 * bridge/agent reachability: the bridge can be online while the daemon itself
 * is down or mid-2FA. Moomoo has no persistent daemon to probe this way (see
 * bridge.py's docstring); its status comes from the last snapshot attempt via
 * /api/jobs/status instead (LiveJobsRow), not this hook.
 */

import { useEffect, useState } from 'react'

import { getHealth } from '@/lib/api'

export type BackendStatus = 'loading' | 'online' | 'agent-offline' | 'backend-offline'

export interface ZerodhaDaemonState {
  reachable: boolean
  authenticated: boolean
}

export interface BackendHealthState {
  status: BackendStatus
  /** Newest export-file mtime from the bridge (ISO UTC), null until known. */
  exportsGeneratedAt: string | null
  /** Data run time (latest.json asOf) from the bridge, null until known. */
  asOf: string | null
  /** Live Zerodha daemon probe; null while 'loading' or when the bridge itself is unreachable. */
  zerodhaDaemon: ZerodhaDaemonState | null
}

export function useBackendHealth(pollMs = 10_000): BackendHealthState {
  const [state, setState] = useState<BackendHealthState>({
    status: 'loading',
    exportsGeneratedAt: null,
    asOf: null,
    zerodhaDaemon: null,
  })

  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        const h = await getHealth()
        if (alive) {
          setState({
            status: h.agent ? 'online' : 'agent-offline',
            exportsGeneratedAt: h.pipeline.exportsGeneratedAt,
            asOf: h.pipeline.asOf,
            zerodhaDaemon: h.daemons.zerodha,
          })
        }
      } catch {
        // fetch failed entirely => bridge (:8001) not reachable
        if (alive) {
          setState({ status: 'backend-offline', exportsGeneratedAt: null, asOf: null, zerodhaDaemon: null })
        }
      }
    }
    check()
    const id = window.setInterval(check, pollMs)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [pollMs])

  return state
}