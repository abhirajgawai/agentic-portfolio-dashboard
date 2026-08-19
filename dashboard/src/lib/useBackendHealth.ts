/**
 * Polls the bridge's /api/health so the UI can surface backend state — the
 * local-dev stand-in for the M9 staleness monitor.
 *
 * Four states (three real, plus a transient 'loading'):
 *   - 'loading'         first poll has not resolved yet
 *   - 'online'          bridge reachable AND opencode serve reachable (agent:true)
 *   - 'agent-offline'  bridge reachable but opencode serve down (agent:false)
 *   - 'backend-offline' the bridge itself (:8000) is unreachable — the fetch threw,
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
 */

import { useEffect, useState } from 'react'

import { getHealth } from '@/lib/api'

export type BackendStatus = 'loading' | 'online' | 'agent-offline' | 'backend-offline'

export interface BackendHealthState {
  status: BackendStatus
  /** Newest export-file mtime from the bridge (ISO UTC), null until known. */
  exportsGeneratedAt: string | null
  /** Data run time (latest.json asOf) from the bridge, null until known. */
  asOf: string | null
}

export function useBackendHealth(pollMs = 10_000): BackendHealthState {
  const [state, setState] = useState<BackendHealthState>({
    status: 'loading',
    exportsGeneratedAt: null,
    asOf: null,
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
          })
        }
      } catch {
        // fetch failed entirely => bridge (:8000) not reachable
        if (alive) {
          setState({ status: 'backend-offline', exportsGeneratedAt: null, asOf: null })
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