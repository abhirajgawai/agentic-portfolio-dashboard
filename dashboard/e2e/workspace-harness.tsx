import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { CasImportScreen } from '@/components/cas/CasImportScreen'
import { PerformanceScreen } from '@/components/performance/PerformanceScreen'
import { SegmentsScreen } from '@/components/segments/SegmentsScreen'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DensityProvider } from '@/lib/density'
import { PrivacyProvider } from '@/lib/privacy'
import { ThemeProvider } from '@/lib/theme'
import '@/index.css'

const screen = new URLSearchParams(window.location.search).get('screen')
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function Screen() {
  if (screen === 'cas') return <CasImportScreen />
  if (screen === 'performance') return <PerformanceScreen />
  if (screen === 'segments') return <SegmentsScreen setTransientDossier={() => undefined} />
  return <p>Unknown workspace</p>
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ThemeProvider>
        <DensityProvider>
          <PrivacyProvider>
            <main className="min-w-0 p-3 sm:p-4"><Screen /></main>
          </PrivacyProvider>
        </DensityProvider>
      </ThemeProvider>
    </TooltipProvider>
  </QueryClientProvider>,
)
