/**
 * src/components/layout/ManageMenu.tsx — Secondary nav dropdown for the two
 * data-entry workspaces (Properties, Groww/Sharekhan Data) that don't get a
 * primary pill tab in the Ledger Gold nav restructure (design brief §3).
 * Icon-button trigger sized to match the other action-cluster buttons in
 * Header.tsx (Refresh/Chat/Privacy — `Button variant="ghost" size="sm"`).
 */

import { LayoutGrid } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { WORKSPACES, type WorkspaceId } from '@/lib/workspaces'

const MANAGE_WORKSPACE_IDS: WorkspaceId[] = ['properties', 'groww-sharekhan']

export function ManageMenu({
  workspace,
  onWorkspaceChange,
}: {
  workspace: WorkspaceId
  onWorkspaceChange: (ws: WorkspaceId) => void
}) {
  const items = WORKSPACES.filter((w) => MANAGE_WORKSPACE_IDS.includes(w.id))
  const activeInMenu = items.some((w) => w.id === workspace)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-8 px-2 gap-1.5 text-xs cursor-pointer',
            activeInMenu
              ? 'text-foreground bg-accent/50'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-label="Manage data sources"
          title="Manage: Properties, Groww/Sharekhan Data"
        >
          <LayoutGrid className="size-3.5" />
          <span className="hidden sm:inline">Manage</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onSelect={() => onWorkspaceChange(w.id)}
            className={cn(workspace === w.id && 'bg-accent text-accent-foreground')}
          >
            {w.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
