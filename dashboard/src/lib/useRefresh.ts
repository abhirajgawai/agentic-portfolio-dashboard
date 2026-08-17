/**
 * Refresh orchestration — POST /api/refresh, then invalidate the four contract
 * queries so every screen re-renders from the regenerated JSONs.
 */

import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { refreshData, BridgeRefreshError } from '@/lib/api'

export type RefreshState =
  | { status: 'idle'; detail: string | null }
  | { status: 'running'; detail: string | null }
  | { status: 'done'; detail: string }
  | { status: 'error'; detail: string }

const CONTRACT_KEYS = ['latest', 'history', 'alerts', 'xirr'] as const

function summarize(summary: unknown): string {
  if (summary === null || summary === undefined) return 'ok'
  if (typeof summary === 'string') return summary.slice(0, 300)
  const s = summary as { snapshot?: { stdout?: string }; export?: { stdout?: string } }
  const snap = (s.snapshot?.stdout ?? '').split('\n')[0] ?? ''
  const exp = (s.export?.stdout ?? '').split('\n')[0] ?? ''
  return [snap, exp].filter(Boolean).join(' · ')
}

export function useRefresh() {
  const queryClient = useQueryClient()
  const [state, setState] = useState<RefreshState>({ status: 'idle', detail: null })

  const run = useCallback(async (): Promise<'done' | 'error'> => {
    setState({ status: 'running', detail: null })
    try {
      const res = await refreshData()
      if (!res.ok) throw new BridgeRefreshError(res.error)
      await Promise.all(
        CONTRACT_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      )
      setState({ status: 'done', detail: summarize(res.summary) })
      return 'done'
    } catch (err) {
      const detail =
        err instanceof BridgeRefreshError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
      setState({ status: 'error', detail })
      return 'error'
    }
  }, [queryClient])

  const reset = useCallback(() => setState({ status: 'idle', detail: null }), [])

  return { state, run, reset }
}