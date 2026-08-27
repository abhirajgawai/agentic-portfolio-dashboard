/**
 * Typed data client — THE ONLY seam between the dashboard and the pipeline.
 *
 * Today: fetches the five static JSON files from `public/data/` (same origin,
 * served by Vite in dev, copied to dist in build).
 *
 * M9: point VITE_DATA_BASE_URL at the Supabase/PostgREST backend and the same
 * Zod schemas (src/types/contract.ts) validate the identical shapes — no
 * component changes. This module is the whole swap surface.
 */

import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { AlertsSchema, GoalsSchema, HistorySchema, LatestSchema, PerformanceSchema, XirrSchema, PropertyImportRequestSchema, PropertyImportResponseSchema, ManualHoldingRequestSchema, ManualHoldingResponseSchema, JobsStatusSchema, SnapshotTriggerResponseSchema } from '@/types/contract'

/** Base URL for the contract files. Empty = same origin (`/data/*.json`). */
const DATA_ROOT = (import.meta.env.VITE_DATA_BASE_URL as string | undefined) ?? ''

const dataUrl = (name: string) => `${DATA_ROOT}/data/${name}`

export class ContractError extends Error {
  constructor(file: string, detail: string) {
    super(`[${file}] ${detail}`)
    this.name = 'ContractError'
  }
}

/** Fetch + parse one contract file; throws ContractError on any failure. */
async function loadJson<T>(file: string, url: string, schema: z.ZodType<T>): Promise<T> {
  let res: Response
  try {
    res = await fetch(url)
  } catch (cause) {
    throw new ContractError(
      file,
      `network error fetching ${url} — served by the pipeline export? (${String(cause)})`,
    )
  }
  if (!res.ok) {
    throw new ContractError(file, `HTTP ${res.status} fetching ${url}`)
  }
  const raw: unknown = await res.json()
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new ContractError(
      file,
      `contract violation at ${first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'unknown issue'}`,
    )
  }
  return parsed.data
}

export const loadLatest = () => loadJson('latest.json', dataUrl('latest.json'), LatestSchema)
export const loadHistory = () => loadJson('history.json', dataUrl('history.json'), HistorySchema)
export const loadAlerts = () => loadJson('alerts.json', dataUrl('alerts.json'), AlertsSchema)
export const loadXirr = () => loadJson('xirr.json', dataUrl('xirr.json'), XirrSchema)
export const loadPerformance = () => loadJson('performance.json', dataUrl('performance.json'), PerformanceSchema)
export const loadGoals = () => loadJson('goals.json', dataUrl('goals.json'), GoalsSchema)

/* ------------------------------------------------------------------ */
/* TanStack Query hooks — server state for the five contract files     */
/* ------------------------------------------------------------------ */

const QUERY_OPTIONS = {
  staleTime: 60_000, // JSONs change only on export/refresh; 1min is generous
  refetchOnWindowFocus: false,
  retry: 1,
} as const

export function useLatest() {
  return useQuery({ queryKey: ['latest'], queryFn: loadLatest, ...QUERY_OPTIONS })
}

export function useHistory() {
  return useQuery({ queryKey: ['history'], queryFn: loadHistory, ...QUERY_OPTIONS })
}

export function useAlerts() {
  return useQuery({ queryKey: ['alerts'], queryFn: loadAlerts, ...QUERY_OPTIONS })
}

export function useXirr() {
  return useQuery({ queryKey: ['xirr'], queryFn: loadXirr, ...QUERY_OPTIONS })
}

export function usePerformance() {
  return useQuery({ queryKey: ['performance'], queryFn: loadPerformance, ...QUERY_OPTIONS })
}

export function useGoalsData() {
  return useQuery({ queryKey: ['goals'], queryFn: loadGoals, ...QUERY_OPTIONS })
}

/* ------------------------------------------------------------------ */
/* Property import (POST to bridge)                                    */
/* ------------------------------------------------------------------ */

export type PropertyImportRequest = z.infer<typeof PropertyImportRequestSchema>
export type PropertyImportResponse = z.infer<typeof PropertyImportResponseSchema>

/** Base URL for the bridge API (same origin in dev via Vite proxy). */
const API_ROOT = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

const apiUrl = (path: string) => `${API_ROOT}/api${path}`

/** Import or update a property valuation via the bridge. */
export async function importProperty(req: PropertyImportRequest): Promise<PropertyImportResponse> {
  const res = await fetch(apiUrl('/property/import'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  const raw: unknown = await res.json()
  const parsed = PropertyImportResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Property import response invalid: ${parsed.error.message}`)
  }
  if (!res.ok || !parsed.data.ok) {
    throw new Error(parsed.data.error ?? `HTTP ${res.status}`)
  }
  return parsed.data
}

/* ------------------------------------------------------------------ */
/* Property delete (DELETE to bridge)                                  */
/* ------------------------------------------------------------------ */

export const PropertyDeleteResponseSchema = z.object({
  ok: z.boolean(),
  deleted: z.string().optional(),
  export: z.string().optional(),
  error: z.string().optional(),
})

export type PropertyDeleteResponse = z.infer<typeof PropertyDeleteResponseSchema>

/** Delete a property via the bridge. */
export async function deleteProperty(propertyId: string): Promise<PropertyDeleteResponse> {
  const res = await fetch(apiUrl(`/property/${propertyId}`), {
    method: 'DELETE',
  })
  const raw: unknown = await res.json()
  const parsed = PropertyDeleteResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Property delete response invalid: ${parsed.error.message}`)
  }
  if (!res.ok || !parsed.data.ok) {
    throw new Error(parsed.data.error ?? `HTTP ${res.status}`)
  }
  return parsed.data
}

/* ------------------------------------------------------------------ */
/* CAS import (POST multipart to bridge)                               */
/* ------------------------------------------------------------------ */

export const CasImportResponseSchema = z.object({
  ok: z.boolean(),
  import: z.string().optional(),
  export: z.string().optional(),
  error: z.string().optional(),
})

export type CasImportResponse = z.infer<typeof CasImportResponseSchema>

/** Import a CAS PDF via the bridge (file upload). */
export async function importCas(file: File, password: string = ''): Promise<CasImportResponse> {
  const formData = new FormData()
  formData.append('file', file)
  if (password) {
    formData.append('password', password)
  }

  const res = await fetch(apiUrl('/cas/import'), {
    method: 'POST',
    body: formData,
  })

  const raw: unknown = await res.json()
  const parsed = CasImportResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`CAS import response invalid: ${parsed.error.message}`)
  }
  if (!res.ok || !parsed.data.ok) {
    throw new Error(parsed.data.error ?? `HTTP ${res.status}`)
  }
  return parsed.data
}

/* ------------------------------------------------------------------ */
/* CAS request (POST to bridge — triggers the CAMS+KFintech mailback,  */
/* no upload) + schedule (docs/CAMS_KFINTECH_CAS_PLAN.md, Part C)      */
/* ------------------------------------------------------------------ */

export const CasRequestResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
})

export type CasRequestResponse = z.infer<typeof CasRequestResponseSchema>

/** Trigger the automated CAMS+KFintech CAS request. The PDF still arrives by
 * email and must be uploaded via importCas() above. */
export async function requestCas(): Promise<CasRequestResponse> {
  const res = await fetch(apiUrl('/cas/request'), { method: 'POST' })

  const raw: unknown = await res.json()
  const parsed = CasRequestResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`CAS request response invalid: ${parsed.error.message}`)
  }
  if (!res.ok || !parsed.data.ok) {
    throw new Error(parsed.data.error ?? `HTTP ${res.status}`)
  }
  return parsed.data
}

/** Trigger the full unattended CAS loop (request -> Gmail auto-fetch ->
 * import -> dashboard refresh, docs/CAMS_KFINTECH_CAS_PLAN.md Part B).
 * Blocks for as long as the bridge takes (up to ~10 min waiting on the
 * email) - an AbortController timeout slightly ahead of the bridge's own
 * CAS_AUTO_TIMEOUT_S (700s) prevents an indefinite hang if the connection
 * itself stalls rather than the bridge responding with a clean error. */
export async function runCasAuto(): Promise<CasRequestResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 720_000)
  try {
    const res = await fetch(apiUrl('/cas/auto'), { method: 'POST', signal: controller.signal })
    const raw: unknown = await res.json()
    const parsed = CasRequestResponseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`CAS auto response invalid: ${parsed.error.message}`)
    }
    if (!res.ok || !parsed.data.ok) {
      throw new Error(parsed.data.error ?? `HTTP ${res.status}`)
    }
    return parsed.data
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('CAS auto request timed out client-side (12 min) - check the dashboard/logs for the real outcome')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

export const CasScheduleSchema = z.object({
  ok: z.boolean(),
  intervalDays: z.number().nullable().optional(),
  enabled: z.boolean().optional(),
  lastRequestedAt: z.string().nullable().optional(),
  nextDueAt: z.string().nullable().optional(),
  due: z.boolean().optional(),
  reason: z.string().optional(),
  error: z.string().optional(),
})

export type CasSchedule = z.infer<typeof CasScheduleSchema>

async function parseCasSchedule(res: Response): Promise<CasSchedule> {
  const raw: unknown = await res.json()
  const parsed = CasScheduleSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`CAS schedule response invalid: ${parsed.error.message}`)
  }
  if (!res.ok || !parsed.data.ok) {
    throw new Error(parsed.data.error ?? `HTTP ${res.status}`)
  }
  return parsed.data
}

export async function getCasSchedule(): Promise<CasSchedule> {
  const res = await fetch(apiUrl('/cas/schedule'))
  return parseCasSchedule(res)
}

export async function updateCasSchedule(
  update: { intervalDays?: number; enabled?: boolean },
): Promise<CasSchedule> {
  const res = await fetch(apiUrl('/cas/schedule'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  })
  return parseCasSchedule(res)
}

export function useCasSchedule() {
  return useQuery({
    queryKey: ['cas-schedule'],
    queryFn: getCasSchedule,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/* ------------------------------------------------------------------ */
/* Manual equity holdings (Groww/Sharekhan — hand-entered, value-only)  */
/* ------------------------------------------------------------------ */

export type ManualHoldingRequest = z.infer<typeof ManualHoldingRequestSchema>
export type ManualHoldingResponse = z.infer<typeof ManualHoldingResponseSchema>

/** Add or update a manual holding via the bridge (upsert by platform+ticker). */
export async function upsertManualHolding(req: ManualHoldingRequest): Promise<ManualHoldingResponse> {
  const res = await fetch(apiUrl('/manual-holding'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  const raw: unknown = await res.json()
  const parsed = ManualHoldingResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Manual holding response invalid: ${parsed.error.message}`)
  }
  if (!res.ok || !parsed.data.ok) {
    throw new Error(parsed.data.error ?? `HTTP ${res.status}`)
  }
  return parsed.data
}

/** Clear a platform's manual value via the bridge. */
export async function clearManualHolding(platform: string): Promise<ManualHoldingResponse> {
  const res = await fetch(apiUrl(`/manual-holding/${platform}`), { method: 'DELETE' })
  const raw: unknown = await res.json()
  const parsed = ManualHoldingResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Manual holding delete response invalid: ${parsed.error.message}`)
  }
  if (!res.ok || !parsed.data.ok) {
    throw new Error(parsed.data.error ?? `HTTP ${res.status}`)
  }
  return parsed.data
}

/* ------------------------------------------------------------------ */
/* Jobs status + on-demand snapshot trigger                             */
/* ------------------------------------------------------------------ */

export type JobsStatus = z.infer<typeof JobsStatusSchema>
export type SnapshotTriggerResponse = z.infer<typeof SnapshotTriggerResponseSchema>

export async function getJobsStatus(): Promise<JobsStatus> {
  const res = await fetch(apiUrl('/jobs/status'))
  const raw: unknown = await res.json()
  const parsed = JobsStatusSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Jobs status response invalid: ${parsed.error.message}`)
  }
  if (!res.ok || !parsed.data.ok) {
    throw new Error(parsed.data.error ?? `HTTP ${res.status}`)
  }
  return parsed.data
}

export function useJobsStatus() {
  return useQuery({
    queryKey: ['jobs-status'],
    queryFn: getJobsStatus,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/** Trigger an on-demand forced snapshot for one live leg (zerodha|moomoo). */
export async function triggerSnapshot(platform: 'zerodha' | 'moomoo'): Promise<SnapshotTriggerResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 930_000)
  try {
    const res = await fetch(apiUrl(`/snapshot/${platform}`), { method: 'POST', signal: controller.signal })
    const raw: unknown = await res.json()
    const parsed = SnapshotTriggerResponseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`Snapshot trigger response invalid: ${parsed.error.message}`)
    }
    if (!res.ok || !parsed.data.ok) {
      throw new Error(parsed.data.error ?? `HTTP ${res.status}`)
    }
    return parsed.data
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Snapshot request timed out client-side (15.5 min)')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}