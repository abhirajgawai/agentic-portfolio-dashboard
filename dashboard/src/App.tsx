import { AppShell } from '@/components/layout/AppShell'
import { PrivacyProvider } from '@/lib/privacy'
import { ThemeProvider } from '@/lib/theme'
import { DensityProvider } from '@/lib/density'

export default function App() {
  return (
    <ThemeProvider>
      <DensityProvider>
        <PrivacyProvider>
          <AppShell />
        </PrivacyProvider>
      </DensityProvider>
    </ThemeProvider>
  )
}