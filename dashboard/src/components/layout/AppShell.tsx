/**
 * src/components/layout/AppShell.tsx — Single-pane layout:
 * Header on top (brand + workspace tabs + actions), WorkspaceCenter fills
 * remaining height, HealthTicker footer.
 * Sidebars removed — Holdings and Allocation live in dedicated tabs now.
 */

import { useState, useEffect, useRef } from 'react'
import { useTheme } from '@/lib'
import { useLatest } from '@/lib/data'
import { useRefresh } from '@/lib/useRefresh'
import { useBackendHealth } from '@/lib/useBackendHealth'
import { useWorkspace } from '@/lib/workspaces'

import { Header } from './Header'
import { HealthTicker } from './HealthTicker'
import { RefreshNotice } from './RefreshNotice'
import { WorkspaceCenter } from '../shell/WorkspaceCenter'
import { ChatDrawer } from '@/components/chat/ChatDrawer'

export function AppShell() {
  const { theme } = useTheme()
  const latest = useLatest()
  const health = useBackendHealth()
  // Lifted so the Header can render "last refreshed" and the reload banner can
  // suppress itself after a MANUAL refresh (the UI already re-fetched live, so a
  // "reload to see latest" banner would be contradictory in that case).
  const refresh = useRefresh()
  const [manualRefreshCount, setManualRefreshCount] = useState(0)
  useEffect(() => {
    if (refresh.state.status === 'done') setManualRefreshCount((c) => c + 1)
  }, [refresh.state.status])

  // Workspace state (lifted so Header tabs + WorkspaceCenter content stay in sync)
  const { workspace, setWorkspace, setTransientDossier } = useWorkspace('journey')

  // Chat drawer open state
  const [chatOpen, setChatOpen] = useState(false)

  // Focus management: when chatOpen transitions false, return focus to the
  // header toggle (stable id="chat-toggle"). Never move focus on OPEN — the
  // drawer's own textarea autofocus handles that. The wasOpen ref skips the
  // initial mount (chatOpen starts false; we must not steal focus on load).
  const prevChatOpen = useRef(chatOpen)
  useEffect(() => {
    const wasOpen = prevChatOpen.current
    prevChatOpen.current = chatOpen
    if (wasOpen && !chatOpen) {
      document.getElementById('chat-toggle')?.focus()
    }
  }, [chatOpen])

  // Persist theme on change
  useEffect(() => {
    try {
      window.localStorage.setItem('portfolio.theme', theme)
    } catch { /* storage unavailable */ }
  }, [theme])

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* ==== HEADER (with workspace tabs) ==== */}
      <Header
        chatOpen={chatOpen}
        onChatToggle={() => setChatOpen((v) => !v)}
        workspace={workspace}
        onWorkspaceChange={setWorkspace}
        refresh={refresh}
      />

      {/* ==== NEW-DATA RELOAD NOTICE ==== */}
      <RefreshNotice health={health} manualRefreshCount={manualRefreshCount} />

      {/* ==== WORKSPACE CONTENT (full width, no sidebars) ==== */}
      <div className="relative z-0 flex h-0 flex-1">
        <WorkspaceCenter
          workspace={workspace}
          setTransientDossier={setTransientDossier}
        />
      </div>

      {/* ==== CHAT DRAWER (overlay) ==== */}
      {chatOpen && (
        <ChatDrawer
          onClose={() => setChatOpen(false)}
          hasAgentData={latest.data !== undefined}
        />
      )}

      {/* ==== FOOTER: HEALTH TICKER ==== */}
      <HealthTicker />
    </div>
  )
}
