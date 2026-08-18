/**
 * Polls the bridge's /api/health so the UI can surface backend state — the
 * local-dev stand-in for the M9 staleness monitor.
 *
 * Three real states (plus a transient 'loading'):
 *   - 'online'          bridge reachable AND opencode serve reachable (agent:true)
 *   - 'agent-offline'  bridge reachable but opencode serve down (agent:false)
 *   - 'backend-offline' the bridge itself (:8000) is unreachable — the fetch threw,
 *                        i.e. `npm run dev:stack` (or the bridge) is not running.
 *
 * Health only distinguishes bridge-up/down via the fetch succeeding; an unreachable
 * bridge throws before we ever read the JSON, so we catch that as backend-offline.
 */

import { useEffect, useState } from 'react'

import { getHealth } from '@/lib/api'

export type BackendStatus = 'loading' | 'online' | 'agent-offline' | 'backend-offline'

export function useBackendHealth(pollMs = 10_000): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>('loading')

  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        const h = await getHealth()
        if (alive) setStatus(h.agent ? 'online' : 'agent-offline')
      } catch {
        // fetch failed entirely => bridge (:8000) not reachable
        if (alive) setStatus('backend-offline')
      }
    }
    check()
    const id = window.setInterval(check, pollMs)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [pollMs])

  return status
}
