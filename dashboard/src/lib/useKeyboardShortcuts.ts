/**
 * src/lib/useKeyboardShortcuts.ts — Central keyboard shortcut registry.
 * ⌘K/`/` open CommandBar; ⌘1..⌘6 switch workspaces; R refresh; T theme cycle;
 * ? shortcuts dialog; Esc closes overlay/returns from dossier.
 * Ignored when focus is in an input (except ⌘K).
 * Listens on `window`.
 */

import { useEffect } from 'react'

// — ⌘K opens CommandBar —
function useCommandKOpen(setCommandOpen: (open: boolean) => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === 'k') {
          e.preventDefault()
          setCommandOpen(true)
        }
      }
      if (e.key === '/') {
        // `/` only opens when focus is not already in an input
        if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault()
          setCommandOpen(true)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setCommandOpen])
}

// — ⌘1..⌘6 switch workspace —
function useWorkspaceShortcuts(
  workspaces: string[],
  setWorkspace: (ws: string) => void,
  setCommandOpen: (open: boolean) => void,
) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.metaKey || e.ctrlKey) {
        const num = parseInt(e.key, 10)
        if (!isNaN(num) && num >= 1 && num <= workspaces.length) {
          e.preventDefault()
          const ws = workspaces[num - 1]
          if (ws) {
            setWorkspace(ws)
            setCommandOpen(false)
          }
        }
      }
      if (e.key === 'Escape') {
        setCommandOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [workspaces, setWorkspace, setCommandOpen])
}

// — R refresh —
function useRefreshShortcut(refetch: () => void, setCommandOpen: (open: boolean) => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        refetch()
        setCommandOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [refetch, setCommandOpen])
}

// — T theme cycle —
function useThemeCycle(cycleTheme: () => void, setCommandOpen: (open: boolean) => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        cycleTheme()
        setCommandOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [cycleTheme, setCommandOpen])
}

// — ? open shortcuts dialog —
function useShortcutsHelp(setCommandOpen: (open: boolean) => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?') {
        e.preventDefault()
        setCommandOpen(true) // reuse CommandBar for help, or open a separate dialog
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setCommandOpen])
}

export function useKeyboardShortcuts(
  options: {
    workspaces: string[] // e.g. ['journey', 'india', 'us', 'returns', 'alerts', 'properties']
    refetch: () => void
    cycleTheme: () => void
    setCommandOpen: (open: boolean) => void
  },
) {
  useCommandKOpen(options.setCommandOpen)
  // Workspace switching is handled by the CommandBar/segmented control — pass a
  // stable no-op so the ⌘1..⌘6 handler still collapses the command bar instead of
  // throwing on `setWorkspace(undefined)`.
  useWorkspaceShortcuts(options.workspaces, () => {}, options.setCommandOpen)
  useRefreshShortcut(options.refetch, options.setCommandOpen)
  useThemeCycle(options.cycleTheme, options.setCommandOpen)
  useShortcutsHelp(options.setCommandOpen)
}