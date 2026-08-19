/**
 * src/lib/use-media-query.ts — Reactive media query hook.
 * Uses window.matchMedia under the hood; updates on change.
 * Safe for SSR (returns false on first render when window is undefined).
 */

import { useState, useEffect } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    const mql = window.matchMedia(query)
    // Sync in case it changed between initial render and effect
    setMatches(mql.matches)

    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}
