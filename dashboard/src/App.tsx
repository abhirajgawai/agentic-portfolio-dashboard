import { Toaster } from 'sonner'

import { AppShell } from '@/components/layout/AppShell'
import { PrivacyProvider } from '@/lib/privacy'
import { ThemeProvider, useTheme } from '@/lib/theme'
import { DensityProvider } from '@/lib/density'

/** sonner's Toaster was never mounted anywhere in the tree, so every
 * existing `toast(...)` call (e.g. GoalMilestones.tsx) has been silently
 * doing nothing - fixed here, theme-aware via the app's own ThemeProvider. */
function ThemedToaster() {
  const { theme } = useTheme()
  return <Toaster theme={theme} richColors closeButton />
}

export default function App() {
  return (
    <ThemeProvider>
      <DensityProvider>
        <PrivacyProvider>
          <AppShell />
          <ThemedToaster />
        </PrivacyProvider>
      </DensityProvider>
    </ThemeProvider>
  )
}