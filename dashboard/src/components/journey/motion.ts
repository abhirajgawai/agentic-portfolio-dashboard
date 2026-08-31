/**
 * Reduced-motion helpers (a11y-spec §6). The cached check is read once per
 * session; the hook additionally subscribes to live preference changes.
 * `useAnimatedNumber` (animation.ts) and every ECharts option consult this.
 */

import { useEffect, useState } from 'react'

export const SPRING_CONFIG_MILESTONE_POP = { type: "spring", stiffness: 420, damping: 18, mass: 0.6 } as const
export const SPRING_CONFIG_NUMBER = { type: "spring", stiffness: 180, damping: 22, mass: 1 } as const

let cachedReduceMotion: boolean | null = null

/** Cached prefers-reduced-motion check — read once per session. */
export function prefersReducedMotion(): boolean {
  if (cachedReduceMotion === null) {
    cachedReduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }
  return cachedReduceMotion
}

/** Reactive variant — re-evaluates if the OS preference changes mid-session. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}
