/**
 * src/lib/density.tsx — Density toggle persistence.
 * data-density="comfortable|compact" on <html>, persisted; auto-comfortable
 * below 640px (media query). Row heights + paddings from --row-* tokens.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const DENSITY_KEY = 'portfolio.density'

type Density = 'comfortable' | 'compact'

interface DensityContextValue {
  density: Density
  setDensity: (d: Density) => void
  toggleDensity: () => void
}

const DensityContext = createContext<DensityContextValue | null>(null)

function readInitialDensity(): Density {
  try {
    const stored = window.localStorage.getItem(DENSITY_KEY)
    if (stored === 'compact' || stored === 'comfortable') return stored
  } catch { /* fall through */ }
  return 'comfortable'
}

function applyDensity(d: Density) {
  document.documentElement.dataset.density = d
}

export function DensityProvider({ children }: { children: React.ReactNode }) {
  const [density, setDensity] = useState<Density>(readInitialDensity)

  useEffect(() => {
    applyDensity(density)
    try {
      window.localStorage.setItem(DENSITY_KEY, density)
    } catch { /* storage unavailable — in-memory still works */ }
  }, [density])

  const toggleDensity = useCallback(() => {
    setDensity(prev => (prev === 'comfortable' ? 'compact' : 'comfortable'))
  }, [])

  return (
    <DensityContext.Provider value={{ density, setDensity, toggleDensity }}>
      {children}
    </DensityContext.Provider>
  )
}

export function useDensity(): DensityContextValue {
  const ctx = useContext(DensityContext)
  if (!ctx) throw new Error('useDensity must be used within <DensityProvider>')
  return ctx
}

export type { DensityContextValue }
