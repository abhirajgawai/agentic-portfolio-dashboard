import { AppShell } from '@/components/layout/AppShell'
import { PrivacyProvider } from '@/lib/privacy'

export default function App() {
  return (
    <PrivacyProvider>
      <AppShell />
    </PrivacyProvider>
  )
}