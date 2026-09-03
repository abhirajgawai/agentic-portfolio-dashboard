/**
 * Bridge API types — the /api contract served by the FastAPI bridge
 * (src/portfolio/bridge.py on 127.0.0.1:8001, proxied by Vite).
 *
 * Three endpoints:
 *   GET  /api/health   -> { pipeline: {asOf, exportsPresent, exportsGeneratedAt}, agent: bool,
 *                          daemons: {zerodha: {reachable, authenticated}} }
 *   POST /api/refresh  -> { ok: true, summary } | 502 { ok: false, error }
 *   POST /api/ask      -> { answer, toolCalls[], turns, withinBudget }
 *                      | 503 { error: 'agent offline' }
 *   POST /api/agent/wake -> { ok: true, state: 'already-online'|'started' }
 *                        | 502 { ok: false, error }
 *   POST   /api/goals      -> { ok: true, goal } | non-2xx { ok: false, error }
 *   PATCH  /api/goals/{id} -> { ok: true, goal } | non-2xx { ok: false, error }
 *   DELETE /api/goals/{id} -> { ok: true, goal } | non-2xx { ok: false, error }
 *
 * exportsGeneratedAt = the mtime of the newest export file (ISO UTC) — "when
 * the dashboard files were last regenerated". The reload banner keys on THIS
 * advancing, not on asOf (a pipeline run can happen without an export).
 */

import { z } from 'zod'

import { GoalSchema } from './contract'

export const HealthSchema = z.object({
  pipeline: z.object({
    asOf: z.string().nullable(),
    exportsPresent: z.boolean(),
    exportsGeneratedAt: z.string().nullable(),
  }),
  agent: z.boolean(),
  daemons: z.object({
    zerodha: z.object({
      reachable: z.boolean(),
      authenticated: z.boolean(),
    }),
  }),
})

export const ToolCallSummarySchema = z.object({
  tool: z.string(),
  status: z.string(),
})

export const AskResponseSchema = z.object({
  answer: z.string(),
  toolCalls: z.array(ToolCallSummarySchema),
  turns: z.number(),
  withinBudget: z.boolean(),
})

/** refresh is a discriminated union on `ok`. */
export const RefreshOkSchema = z.object({
  ok: z.literal(true),
  summary: z.unknown(),
})

export const RefreshErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

export const RefreshResponseSchema = z.discriminatedUnion('ok', [
  RefreshOkSchema,
  RefreshErrorSchema,
])

/** agent wake is a discriminated union on `ok`. */
export const AgentWakeOkSchema = z.object({
  ok: z.literal(true),
  state: z.enum(['already-online', 'started']),
})

export const AgentWakeErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

export const AgentWakeSchema = z.discriminatedUnion('ok', [
  AgentWakeOkSchema,
  AgentWakeErrorSchema,
])

/* ------------------------------------------------------------------ */
/* Goals CRUD (M8.9) — POST/PATCH/DELETE /api/goals                    */
/* ------------------------------------------------------------------ */

/** POST /api/goals body — color is optional (bridge picks a palette default). */
export const GoalCreateInputSchema = z.object({
  label: z.string().min(1),
  targetAmount: z.number().positive(),
  color: z.string().optional(),
})

/** PATCH /api/goals/{id} body — a REAL partial update; omitted fields keep
 *  their stored values (the old remove+re-add hack is gone). */
export const GoalUpdateInputSchema = z.object({
  label: z.string().min(1).optional(),
  targetAmount: z.number().positive().optional(),
  color: z.string().optional(),
})

/** Every goals mutation answers with the affected goal on success. */
export const GoalOkSchema = z.object({
  ok: z.literal(true),
  goal: GoalSchema,
})

export const GoalErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

export const GoalResponseSchema = z.discriminatedUnion('ok', [
  GoalOkSchema,
  GoalErrorSchema,
])

export type Health = z.infer<typeof HealthSchema>
export type AskResponse = z.infer<typeof AskResponseSchema>
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>
export type AgentWakeResponse = z.infer<typeof AgentWakeSchema>
export type GoalCreateInput = z.infer<typeof GoalCreateInputSchema>
export type GoalUpdateInput = z.infer<typeof GoalUpdateInputSchema>
export type GoalResponse = z.infer<typeof GoalResponseSchema>