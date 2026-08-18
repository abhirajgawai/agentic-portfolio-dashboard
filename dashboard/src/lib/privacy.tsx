/**
 * Privacy toggle — a screen-level "hide the numbers" switch for showing the
 * dashboard to others.
 *
 * What masking covers (display-only, never touches the JSON contract):
 *   - amounts (₹/SGD money values) and share quantities (qty/units) -> MASK_TEXT
 * What stays visible by design:
 *   - percentages (donut slices, returns, P&L%) — they reveal no net worth
 *   - item counts ("68 holdings", "2 alerts", "7 flows")
 *
 * The preference persists in localStorage (default: visible) so a reload keeps
 * the user's choice. Storage is read through a try/catch: a corrupt value, or
 * unavailable storage (private mode), falls back to visible and never crashes.
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'portfolio.privacy.masked'

/** Parse the stored toggle safely — anything that isn't exactly 'true' = visible. */
function readInitialMasked(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

interface PrivacyContextValue {
  /** True when amounts/quantities are hidden behind MASK_TEXT. */
  masked: boolean
  /** Flip the mask and persist the new value. */
  toggleMasked: () => void
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null)

export function PrivacyProvider({ children }: { children: ReactNode }) {
  // Lazy initializer: reads localStorage once, on first render only.
  const [masked, setMasked] = useState<boolean>(readInitialMasked)

  const toggleMasked = useCallback(() => {
    setMasked((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next))
      } catch {
        // Storage unavailable — the in-memory toggle still works for this session.
      }
      return next
    })
  }, [])

  return (
    <PrivacyContext.Provider value={{ masked, toggleMasked }}>
      {children}
    </PrivacyContext.Provider>
  )
}

// The hook intentionally lives with its provider so the pair is discoverable in
// one file. Fast Refresh's component-only-export rule can't model a context
// file, so the check is disabled for this single export.
// oxlint-disable-next-line react/only-export-components
export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext)
  if (!ctx) {
    throw new Error('usePrivacy must be used within a <PrivacyProvider>')
  }
  return ctx
}
