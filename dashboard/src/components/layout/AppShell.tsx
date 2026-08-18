import { useState } from 'react'
import { Activity, Bell, ChartLine, Eye, EyeOff, Globe2, Home, Landmark, LayoutDashboard, MessageSquare } from 'lucide-react'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatusBar } from '@/components/layout/StatusBar'
import { OverviewScreen } from '@/components/overview/OverviewScreen'
import { IndiaView } from '@/components/holdings/IndiaView'
import { USView } from '@/components/holdings/USView'
import { ReturnsScreen } from '@/components/returns/ReturnsScreen'
import { AlertsScreen } from '@/components/alerts/AlertsScreen'
import { PropertiesScreen } from '@/components/holdings/PropertiesScreen'
import { ChatDrawer } from '@/components/chat/ChatDrawer'
import { useAlerts, useLatest } from '@/lib/data'
import { usePrivacy } from '@/lib/privacy'
import { cn } from '@/lib/utils'

type TabId = 'overview' | 'india' | 'us' | 'returns' | 'alerts' | 'properties'

const TABS: Array<{ id: TabId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'india', label: 'India', icon: Landmark },
  { id: 'us', label: 'US', icon: Globe2 },
  { id: 'properties', label: 'Properties', icon: Home },
  { id: 'returns', label: 'Returns', icon: ChartLine },
  { id: 'alerts', label: 'Alerts', icon: Bell },
]

export function AppShell() {
  const [tab, setTab] = useState<TabId>('overview')
  const [chatOpen, setChatOpen] = useState(false)
  const latestQuery = useLatest()
  const alertsQuery = useAlerts()
  const { masked, toggleMasked } = usePrivacy()

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar: brand + tab navigation. On <=sm the tab labels hide (icons
          stay) and the tabs region scrolls horizontally instead of clipping
          (min-w-0 lets it shrink inside the flex row; overflow-x-auto is the
          belt). Labels return at sm+ via `hidden sm:inline`. */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 sm:gap-4">
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary/15">
            <Activity className="size-3.5 text-primary" />
          </div>
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">Portfolio</span>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="ml-1 min-w-0 flex-1 sm:ml-2">
          <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList className="h-8 w-max bg-transparent p-0">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  aria-label={t.label}
                  className="gap-1.5 px-2 sm:px-3 data-[state=active]:bg-muted data-[state=active]:shadow-none"
                >
                  <t.icon className="size-3.5" />
                  <span className="hidden sm:inline">{t.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>

        <div className="ml-auto flex items-center gap-3">
          {alertsQuery.data && alertsQuery.data.alerts.length > 0 && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {alertsQuery.data.alerts.length} alert{alertsQuery.data.alerts.length === 1 ? '' : 's'}
            </span>
          )}
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              chatOpen
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
            aria-pressed={chatOpen}
          >
            <MessageSquare className="size-3.5" />
            Chat
          </button>
          {/* Privacy toggle — hides amounts + quantities behind MASK_TEXT.
              Percentages and counts stay visible (they reveal no net worth). */}
          <button
            type="button"
            onClick={toggleMasked}
            className={cn(
              'inline-flex items-center rounded-md px-2 py-1.5 transition-colors',
              masked
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
            aria-pressed={masked}
            aria-label={masked ? 'Show amounts' : 'Hide amounts'}
            title={masked ? 'Show amounts' : 'Hide amounts'}
          >
            {masked ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
      </header>

      <StatusBar
        latest={latestQuery.data}
        alerts={alertsQuery.data}
        onChatToggle={() => setChatOpen((v) => !v)}
        chatOpen={chatOpen}
      />

      {/* Main content + chat drawer */}
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-7xl p-4">
            {tab === 'overview' && <OverviewScreen />}
            {tab === 'india' && <IndiaView />}
            {tab === 'us' && <USView />}
            {tab === 'properties' && <PropertiesScreen />}
            {tab === 'returns' && <ReturnsScreen />}
            {tab === 'alerts' && <AlertsScreen />}
          </div>
        </main>
        {chatOpen && (
          <ChatDrawer
            onClose={() => setChatOpen(false)}
            hasAgentData={latestQuery.data !== undefined}
          />
        )}
      </div>
    </div>
  )
}