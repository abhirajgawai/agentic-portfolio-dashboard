/**
 * Bridge API types — the /api contract served by the FastAPI bridge
 * (src/portfolio/bridge.py on 127.0.0.1:8000, proxied by Vite).
 *
 * Three endpoints:
 *   GET  /api/health   -> { pipeline: {asOf, exportsPresent, exportsGeneratedAt}, agent: bool }
 *   POST /api/refresh  -> { ok: true, summary } | 502 { ok: false, error }
 *   POST /api/ask      -> { answer, toolCalls[], turns, withinBudget }
 *                      | 503 { error: 'agent offline' }
 *
 * exportsGeneratedAt = the mtime of the newest export file (ISO UTC) — "when
 * the dashboard files were last regenerated". The reload banner keys on THIS
 * advancing, not on asOf (a pipeline run can happen without an export).
 */

import { z } from 'zod'

export const HealthSchema = z.object({
  pipeline: z.object({
    asOf: z.string().nullable(),
    exportsPresent: z.boolean(),
    exportsGeneratedAt: z.string().nullable(),
  }),
  agent: z.boolean(),
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

export type Health = z.infer<typeof HealthSchema>
export type AskResponse = z.infer<typeof AskResponseSchema>
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>