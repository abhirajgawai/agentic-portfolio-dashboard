/**
 * Delta counter (motion-spec §2 — refresh → numbers tick 400ms).
 * Shared by JourneyWorkspace's headline and TodayPanel's day P&L.
 */

import { useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from './motion'

/**
 * Eases the displayed number toward `target` over `duration` ms. Skips
 * entirely under prefers-reduced-motion. Returns a float for formatters.
 */
export function useAnimatedNumber(target: number, duration = 400): number {
  const [display, setDisplay] = useState(target)
  const reduced = usePrefersReducedMotion()
  const fromRef = useRef(target)
  const rafRef = useRef(0)

  useEffect(() => {
    const from = fromRef.current
    if (from === target || reduced) {
      fromRef.current = target
      setDisplay(target)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (target - from) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      fromRef.current = target
    }
  }, [target, duration, reduced])

  return display
}
