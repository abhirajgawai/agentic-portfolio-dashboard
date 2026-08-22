/**
 * src/lib/workspaces.ts — Workspace registry: journey | allocation | portfolio | returns | alerts | properties
 * + dossier:<ticker> transient state. useWorkspace hook; command-bar items built
 * from this registry.
 */

import { useState, useEffect } from 'react'
import { type LucideIcon } from 'lucide-react'

export type WorkspaceId =
  | 'journey'
  | 'allocation'
  | 'portfolio'
  | 'returns'
  | 'alerts'
  | 'properties'

export type TransientDossier = {
  ticker: string | null
  previousWorkspace: WorkspaceId | null
}

export interface WorkspaceDescriptor {
  id: WorkspaceId
  label: string
  /** Optional icon — consumed by the CommandBar (spec.md §3.8 builds its items
   *  from this registry). The Header segmented control stays text-only. */
  icon?: LucideIcon
}

export const WORKSPACES: WorkspaceDescriptor[] = [
  { id: 'journey', label: 'Journey' },
  { id: 'allocation', label: 'Allocation' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'returns', label: 'Returns' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'properties', label: 'Properties' },
]

export function useWorkspace(
  anInitialWorkspace: WorkspaceId = 'journey',
): {
  workspace: WorkspaceId
  setWorkspace: (ws: WorkspaceId) => void
  transientDossier: TransientDossier
  setTransientDossier: (d: Partial<TransientDossier>) => void
  isJourney: boolean
} {
  const [workspace, setWorkspace] = useState<WorkspaceId>(anInitialWorkspace)
  const [transientDossier, setTransientDossierState] = useState<TransientDossier>({ ticker: null, previousWorkspace: null })

  // Accept a PARTIAL update and merge with the current dossier (callers pass
  // `{ ticker: null }` to close, `{ ticker, previousWorkspace }` to open).
  const setTransientDossier = (d: Partial<TransientDossier>) => {
    setTransientDossierState((prev) => ({ ...prev, ...d }))
  }

  // persist workspace in localStorage
  useEffect(() => {
    try {
      window.localStorage.setItem('portfolio.workspace', workspace)
    } catch { /* storage unavailable */ }
  }, [workspace])

  const isJourney = workspace === 'journey'

  return {
    workspace,
    setWorkspace: (ws: WorkspaceId) => {
      // save the current workspace as the "previous" before switching
      setTransientDossier({ ticker: null, previousWorkspace: workspace })
      setWorkspace(ws)
    },
    transientDossier,
    setTransientDossier,
    isJourney,
  }
}