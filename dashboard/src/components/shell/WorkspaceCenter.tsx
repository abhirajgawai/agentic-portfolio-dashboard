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
import { ReturnsScreen } from '@/components/returns/ReturnsScreen'
import { AlertsScreen } from '@/components/alerts/AlertsScreen'
import { PropertiesScreen } from '@/components/holdings/PropertiesScreen'

interface WorkspaceCenterProps {
  workspace: WorkspaceId
  setTransientDossier: (d: Partial<TransientDossier>) => void
}

export function WorkspaceCenter({ workspace, setTransientDossier }: WorkspaceCenterProps) {
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
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background min-w-0">
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
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {workspace === 'journey' && (
          <JourneyWorkspace latest={latest.data} masked={masked} onDossierSelect={handleDossierSelect} />
        )}
        {workspace === 'allocation' && <AllocationScreen />}
        {workspace === 'portfolio' && <PortfolioScreen setTransientDossier={setTransientDossier} />}
        {workspace === 'returns' && <ReturnsScreen />}
        {workspace === 'alerts' && <AlertsScreen />}
        {workspace === 'properties' && <PropertiesScreen />}
      </div>
    </div>
  )
}