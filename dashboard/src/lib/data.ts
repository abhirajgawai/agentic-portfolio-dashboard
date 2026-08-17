/**
 * Typed data client — THE ONLY seam between the dashboard and the pipeline.
 *
 * Today: fetches the four static JSON files from `public/data/` (same origin,
 * served by Vite in dev, copied to dist in build).
 *
 * M9: point VITE_DATA_BASE_URL at the Supabase/PostgREST backend and the same
 * Zod schemas (src/types/contract.ts) validate the identical shapes — no
 * component changes. This module is the whole swap surface.
 */

import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { AlertsSchema, HistorySchema, LatestSchema, XirrSchema } from '@/types/contract'

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

/* ------------------------------------------------------------------ */
/* TanStack Query hooks — server state for the four contract files     */
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