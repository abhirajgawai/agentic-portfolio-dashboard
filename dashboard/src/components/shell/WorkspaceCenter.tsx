/**
 * src/components/shell/WorkspaceCenter.tsx — Full-width workspace rendering
 * the active view content. Header (parent) owns the workspace tabs.
 * Receives `workspace` + `setTransientDossier` from AppShell.
 */

import { useState } from 'react'
import { useLatest } from '@/lib/data'
import { usePrivacy } from '@/lib/privacy'
import { type WorkspaceId, type TransientDossier } from '@/lib/workspaces'

import { JourneyWorkspace } from '@/components/workspaces/JourneyWorkspace'
import { AllocationScreen } from '@/components/overview/AllocationScreen'
import { PortfolioScreen } from '@/components/portfolio/PortfolioScreen'
import { AlertsScreen } from '@/components/alerts/AlertsScreen'
import { PropertiesScreen } from '@/components/holdings/PropertiesScreen'
import { GrowwSharekhanDataScreen } from '@/components/holdings/GrowwSharekhanDataScreen'

interface WorkspaceCenterProps {
  workspace: WorkspaceId
  setTransientDossier: (d: Partial<TransientDossier>) => void
  /** Switches the active top-level workspace — threaded down to Journey so its
   *  compact staleness chip can deep-link to Alerts (design brief §3.1/§3.4). */
  onWorkspaceChange: (ws: WorkspaceId) => void
}

export function WorkspaceCenter({ workspace, setTransientDossier, onWorkspaceChange }: WorkspaceCenterProps) {
  const latest = useLatest()
  const { masked } = usePrivacy()

  // Breadcrumb state for dossier drill-down (Journey workspace)
  const [breadcrumb, setBreadcrumb] = useState<string | null>(null)

  const handleDossierSelect = (ticker: string) => {
    const prev = workspace
    setBreadcrumb(`${prev} / ${ticker}`)
    setTransientDossier({ ticker, previousWorkspace: prev })
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 max-w-full flex-1 flex-col bg-background">
      {/* Breadcrumb when a dossier is open */}
      {breadcrumb && (
        <div className="flex items-center gap-2 border-b border-border/30 px-4 py-1.5 text-sm text-muted-foreground">
          <button
            onClick={() => {
              setBreadcrumb(null)
              setTransientDossier({ ticker: null })
            }}
            className="cursor-pointer text-xs font-medium underline underline-offset-2 hover:text-foreground"
          >
            ← Back
          </button>
          <span>{breadcrumb}</span>
        </div>
      )}

      {/* Active workspace content */}
      <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-y-auto p-3 sm:p-4">
        {workspace === 'journey' && (
          <JourneyWorkspace
            latest={latest.data}
            masked={masked}
            onDossierSelect={handleDossierSelect}
            onWorkspaceChange={onWorkspaceChange}
          />
        )}
        {workspace === 'allocation' && <AllocationScreen />}
        {workspace === 'portfolio' && <PortfolioScreen setTransientDossier={setTransientDossier} />}
        {workspace === 'alerts' && <AlertsScreen />}
        {workspace === 'properties' && <PropertiesScreen />}
        {workspace === 'groww-sharekhan' && <GrowwSharekhanDataScreen />}
      </div>
    </div>
  )
}
