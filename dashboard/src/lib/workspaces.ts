/**
 * src/lib/workspaces.ts — Workspace registry: journey | allocation | holdings | returns | alerts | properties
 * + dossier:<ticker> transient state. useWorkspace hook; command-bar items built
 * from this registry.
 */

import { useState, useEffect } from 'react'

export type WorkspaceId =
  | 'journey'
  | 'allocation'
  | 'holdings'
  | 'india'
  | 'us'
  | 'returns'
  | 'alerts'
  | 'properties'
  | 'cas'

export type TransientDossier = {
  ticker: string | null
  previousWorkspace: WorkspaceId | null
}

export const WORKSPACES: { id: WorkspaceId; label: string }[] = [
  { id: 'journey', label: 'Journey' },
  { id: 'india', label: 'India' },
  { id: 'us', label: 'US' },
  { id: 'returns', label: 'Returns' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'properties', label: 'Properties' },
  { id: 'cas', label: 'CAS Import' },
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