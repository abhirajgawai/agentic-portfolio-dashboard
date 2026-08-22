/**
 * src/components/layout/Header.tsx — Unified header: brand + centered workspace tabs
 * + right cluster (theme, refresh, chat, privacy eye).
 * Height 48px (h-12), border-b, backdrop-blur.
 */

import { useState, useRef, useEffect } from 'react'
import { Sun, Moon, Eye, EyeOff, Check, Monitor, RefreshCw, MessageSquare } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTheme, usePrivacy } from '@/lib'
import { cn } from '@/lib/utils'
import type { RefreshState } from '@/lib/useRefresh'
import { type WorkspaceId, WORKSPACES } from '@/lib/workspaces'

/** How long the "Refreshed: …" summary stays visible before reverting to idle. */
const REFRESH_DONE_TIMEOUT_MS = 4000

function truncateDetail(detail: string, maxLen = 160): string {
  const compact = detail.split('\n').slice(0, 2).join(' · ').trim()
  if (compact.length <= maxLen) return compact
  return `${compact.slice(0, maxLen - 1)}…`
}

export function Header({
  chatOpen,
  onChatToggle,
  workspace,
  onWorkspaceChange,
  refresh,
}: {
  chatOpen?: boolean
  onChatToggle?: () => void
  workspace: WorkspaceId
  onWorkspaceChange: (ws: WorkspaceId) => void
  /** Refresh state machine (lifted to AppShell so the reload banner can suppress on manual refresh). */
  refresh: { state: RefreshState; run: () => Promise<'done' | 'error'>; reset: () => void }
}) {
  const { theme, setTheme } = useTheme()
  const { masked, toggleMasked } = usePrivacy()
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const themeMenuRef = useRef<HTMLDivElement>(null)

  const { state: refreshState, run, reset } = refresh
  const refreshing = refreshState.status === 'running'

  // Close theme menu on outside click
  useEffect(() => {
    if (!themeMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [themeMenuOpen])

  useEffect(() => {
    if (refreshState.status !== 'done') return
    const id = window.setTimeout(() => reset(), REFRESH_DONE_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [refreshState.status, reset])

  const handleRefresh = () => { void run() }

  const refreshTitle =
    refreshState.status === 'running'
      ? 'Refreshing portfolio data…'
      : refreshState.status === 'error'
        ? `Refresh failed: ${truncateDetail(refreshState.detail)}`
        : refreshState.status === 'done'
          ? `Refreshed: ${truncateDetail(refreshState.detail)}`
          : 'Run snapshot --all --force + export (live broker pull via the bridge)'

  const ThemeIcon = theme === 'dark' ? Moon : Sun

  return (
    <header className="relative z-10 flex h-12 shrink-0 items-center gap-1 border-b px-3 bg-background/80 backdrop-blur-sm">
      {/* ==== BRAND → HOME ==== */}
      <a
        href="/"
        className="flex shrink-0 items-center gap-2 mr-2 rounded-md px-1.5 py-1 -ml-1.5 text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
        aria-label="Go to home dashboard"
      >
        <div className="flex size-7 items-center justify-center rounded-md bg-primary/10">
          <svg className="size-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <span className="hidden text-sm font-semibold tracking-tight sm:inline">Portfolio</span>
      </a>

      {/* ==== DIVIDER ==== */}
      <div className="w-px h-5 bg-border/50 mx-1 hidden sm:block" />

      {/* ==== WORKSPACE TABS (centered segmented control) ==== */}
      <nav className="flex-1 flex items-center justify-center min-w-0" aria-label="Workspace navigation">
        <div className="flex items-center gap-0.5 rounded-md bg-muted/50 p-1 overflow-x-auto whitespace-nowrap">
          {WORKSPACES.map((w) => (
            <button
              key={w.id}
              type="button"
              className={cn(
                'whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-colors cursor-pointer',
                workspace === w.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
              )}
              onClick={() => onWorkspaceChange(w.id)}
              aria-current={workspace === w.id ? 'page' : undefined}
            >
              {w.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ==== DIVIDER ==== */}
      <div className="w-px h-5 bg-border/50 mx-1 hidden sm:block" />

      {/* ==== THEME TOGGLE ==== */}
      <div className="relative" ref={themeMenuRef}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setThemeMenuOpen(!themeMenuOpen)}
          className="h-8 px-2 gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
          aria-label="Switch theme"
          aria-expanded={themeMenuOpen}
        >
          <ThemeIcon className="size-3.5" />
          <span className="hidden sm:inline text-xs">{theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Auto'}</span>
          <svg className={cn('size-3 opacity-50 transition-transform', themeMenuOpen && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </Button>

        {themeMenuOpen && (
          <div className="absolute right-0 mt-1 w-40 rounded-lg bg-popover p-1 shadow-lg border border-border z-50">
            {([
              { value: 'light' as const, icon: Sun, label: 'Light' },
              { value: 'dark' as const, icon: Moon, label: 'Dark' },
              { value: 'system' as const, icon: Monitor, label: 'Auto' },
            ]).map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                  theme === value
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
                onClick={() => { setTheme(value); setThemeMenuOpen(false) }}
              >
                <Icon className="size-3.5" />
                <span>{label}</span>
                {theme === value && <Check className="ml-auto size-3.5" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ==== DIVIDER ==== */}
      <div className="w-px h-5 bg-border/50 mx-1 hidden sm:block" />

      {/* ==== ACTION BUTTONS ==== */}
      <div className="flex items-center gap-0.5">
        {/* Refresh */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          title={refreshTitle}
          className={cn(
            'h-8 px-2 gap-1.5 text-xs cursor-pointer',
            refreshing
              ? 'text-primary animate-pulse'
              : refreshState.status === 'error'
                ? 'text-loss hover:text-loss'
                : refreshState.status === 'done'
                  ? 'text-gain'
                  : 'text-muted-foreground hover:text-foreground',
          )}
          aria-label={refreshing ? 'Refreshing portfolio data…' : 'Refresh now'}
        >
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          <span className="hidden sm:inline">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
        </Button>

        {/* Chat */}
        <Button
          type="button"
          id="chat-toggle"
          variant="ghost"
          size="sm"
          onClick={onChatToggle}
          className={cn(
            'h-8 px-2 gap-1.5 text-xs cursor-pointer',
            chatOpen
              ? 'text-foreground bg-accent/50'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-pressed={chatOpen}
          aria-label="Toggle chat"
        >
          <MessageSquare className="size-3.5" />
          <span className="hidden sm:inline text-xs">Chat</span>
        </Button>

        {/* Privacy */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={toggleMasked}
          className={cn(
            'h-8 px-2 cursor-pointer',
            masked
              ? 'text-foreground bg-accent/50'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-pressed={masked}
          aria-label={masked ? 'Show amounts' : 'Hide amounts'}
          title={masked ? 'Show amounts' : 'Hide amounts'}
        >
          {masked ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </Button>
      </div>

      {/* ==== ARIA-LIVE REFRESH STATUS ==== */}
      <span className="sr-only" role="status">
        {refreshState.status === 'running'
          ? 'Refreshing portfolio data…'
          : refreshState.status === 'done'
            ? `Refreshed: ${truncateDetail(refreshState.detail)}`
            : refreshState.status === 'error'
              ? `Refresh failed: ${truncateDetail(refreshState.detail)}`
              : ''}
      </span>
    </header>
  )
}
