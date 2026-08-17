/**
 * Bridge HTTP client — talks to the local FastAPI bridge through the Vite
 * dev proxy (/api/* -> 127.0.0.1:8000). In M9 these calls move to Supabase
 * (edge function / PostgREST) with the same response shapes.
 */

import type { AskResponse, Health, RefreshResponse } from '@/types/bridge'
import { AskResponseSchema, HealthSchema, RefreshResponseSchema } from '@/types/bridge'

const API_ROOT = '/api'

async function parseJson<T>(res: Response, schema: { safeParse(data: unknown): { success: true; data: T } | { success: false } }, label: string): Promise<T> {
  const raw: unknown = await res.json()
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`[${label}] unexpected response shape`)
  }
  return parsed.data
}

export async function getHealth(): Promise<Health> {
  const res = await fetch(`${API_ROOT}/health`)
  if (!res.ok) throw new Error(`[health] HTTP ${res.status}`)
  return parseJson(res, HealthSchema, 'health')
}

export type AskOptions = { timeoutMs?: number }

export async function askQuestion(question: string, opts: AskOptions = {}): Promise<AskResponse> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), opts.timeoutMs ?? 240_000)
  try {
    const res = await fetch(`${API_ROOT}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: controller.signal,
    })
    if (res.status === 503) {
      throw new AgentOfflineError('agent offline')
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`[ask] HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    return parseJson(res, AskResponseSchema, 'ask')
  } finally {
    window.clearTimeout(timer)
  }
}

export class AgentOfflineError extends Error {
  constructor(message = 'agent offline') {
    super(message)
    this.name = 'AgentOfflineError'
  }
}

/**
 * POST /api/refresh — runs the pipeline (snapshot --all --force + export)
 * and regenerates the four JSONs. Throws BridgeRefreshError on {ok:false}.
 */
export async function refreshData(): Promise<RefreshResponse> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 600_000) // snapshot can take minutes
  try {
    const res = await fetch(`${API_ROOT}/refresh`, {
      method: 'POST',
      signal: controller.signal,
    })
    if (!res.ok && res.status !== 502) {
      throw new Error(`[refresh] HTTP ${res.status}`)
    }
    const parsed = await parseJson(res, RefreshResponseSchema, 'refresh')
    if (!parsed.ok) {
      throw new BridgeRefreshError(parsed.error)
    }
    return parsed
  } finally {
    window.clearTimeout(timer)
  }
}

export class BridgeRefreshError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeRefreshError'
  }
}