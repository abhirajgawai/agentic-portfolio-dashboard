/**
 * Bridge HTTP client — talks to the local FastAPI bridge through the Vite
 * dev proxy (/api/* -> 127.0.0.1:8001). In M9 these calls move to Supabase
 * (edge function / PostgREST) with the same response shapes.
 */

import type { AgentWakeResponse, AskResponse, GoalCreateInput, GoalResponse, GoalUpdateInput, Health, RefreshResponse } from '@/types/bridge'
import {
  AgentWakeSchema,
  AskResponseSchema,
  GoalResponseSchema,
  HealthSchema,
  RefreshResponseSchema,
} from '@/types/bridge'
import { z } from 'zod'

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

/**
 * POST /api/agent/wake — asks the bridge to spawn `opencode serve` detached
 * (returns immediately; /api/health flips agent:true within seconds).
 * 502 {ok:false, error} is a parseable body like refresh: we surface the
 * bridge's error message, never swallow it. Throws Error('[wake] ...') on
 * network failure or a malformed response.
 */
export async function wakeAgent(): Promise<AgentWakeResponse> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 15_000) // wake is immediate; belt anyway
  try {
    let res: Response
    try {
      res = await fetch(`${API_ROOT}/agent/wake`, {
        method: 'POST',
        signal: controller.signal,
      })
    } catch (err) {
      throw new Error(`[wake] ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!res.ok && res.status !== 502) {
      throw new Error(`[wake] HTTP ${res.status}`)
    }
    const parsed = await parseJson(res, AgentWakeSchema, 'wake')
    if (!parsed.ok) {
      throw new Error(`[wake] ${parsed.error}`)
    }
    return parsed
  } finally {
    window.clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/* /api/goals — savings-goal CRUD (M8.9)                               */
/* ------------------------------------------------------------------ */

/**
 * Shared transport for the three goal mutations. Mirrors wakeAgent: abort
 * belt, network errors wrapped with the endpoint label, and the bridge's
 * {ok:false, error} body surfaced as the thrown message instead of a bare
 * HTTP code (pinned contract: errors arrive as JSON on non-2xx).
 */
async function goalRequest(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<GoalResponse> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 15_000) // local bridge; fast
  try {
    let res: Response
    try {
      res = await fetch(`${API_ROOT}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      throw new Error(`[goals] ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!res.ok) {
      // Non-2xx per contract carries {ok:false, error} — extract the real
      // message; if the body isn't that shape (proxy/HTML error), fall back
      // to the status code rather than leaking a parse stack.
      const parsed = await parseJson(res, GoalResponseSchema, 'goals').catch(() => null)
      if (parsed && !parsed.ok) throw new Error(`[goals] ${parsed.error}`)
      throw new Error(`[goals] HTTP ${res.status}`)
    }
    const parsed = await parseJson(res, GoalResponseSchema, 'goals')
    if (!parsed.ok) {
      throw new Error(`[goals] ${parsed.error}`)
    }
    return parsed
  } finally {
    window.clearTimeout(timer)
  }
}

/** POST /api/goals — create a goal ({label, targetAmount, color?}). */
export function createGoal(input: GoalCreateInput): Promise<GoalResponse> {
  return goalRequest('POST', '/goals', input)
}

/** PATCH /api/goals/{id} — partial update; omitted fields are kept. */
export function updateGoal(id: number, patch: GoalUpdateInput): Promise<GoalResponse> {
  return goalRequest('PATCH', `/goals/${id}`, patch)
}

/** DELETE /api/goals/{id} — remove a goal. */
export function deleteGoal(id: number): Promise<GoalResponse> {
  return goalRequest('DELETE', `/goals/${id}`)
}

/* ------------------------------------------------------------------ */
/* /api/live — live holdings with day P&L for TodayPanel polling      */
/* ------------------------------------------------------------------ */

/** One holding from /api/live — subset of Latest.holdings with live day fields. */
export const LiveHoldingSchema = z.object({
  ticker: z.string(),
  platform: z.string(),
  geography: z.string(),
  currency: z.string(),
  displayCurrency: z.string(),
  valueDisplay: z.number(),
  dayPnl: z.number().nullable(),
  dayChangePct: z.number().nullable(),
})

export const LiveResponseSchema = z.object({
  asOf: z.string().nullable(),
  holdings: z.array(LiveHoldingSchema),
})

export type LiveHolding = z.infer<typeof LiveHoldingSchema>
export type LiveResponse = z.infer<typeof LiveResponseSchema>

/**
 * POST /api/live — returns live holdings with current day P&L.
 * Used by TodayPanel for 60s polling during market hours.
 * Throws on network error or contract violation.
 */
export async function livePoll(): Promise<LiveResponse> {
  const res = await fetch(`${API_ROOT}/live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    throw new Error(`[live] HTTP ${res.status}`)
  }
  return parseJson(res, LiveResponseSchema, 'live')
}