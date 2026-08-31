/**
 * Delta counter (motion-spec §2 — refresh → numbers settle with a spring).
 * Shared by JourneyWorkspace's headline and TodayPanel's day P&L.
 */

import { animate, motionValue } from 'motion'
import { useEffect, useRef, useState } from 'react'
import { SPRING_CONFIG_NUMBER, usePrefersReducedMotion } from './motion'

/**
 * Springs the displayed number toward `target`. Skips entirely under
 * prefers-reduced-motion. Returns a float for formatters.
 */
export function useAnimatedNumber(target: number, duration = 400): number {
  const [display, setDisplay] = useState(target)
  const reduced = usePrefersReducedMotion()
  const valueRef = useRef(motionValue(target))
  const previousTargetRef = useRef(target)

  // Kept for source compatibility; spring physics do not use a fixed duration.
  void duration

  useEffect(() => {
    const value = valueRef.current
    const unsubscribe = value.on('change', setDisplay)

    if (reduced) {
      previousTargetRef.current = target
      value.set(target)
      setDisplay(target)
      return unsubscribe
    }

    if (previousTargetRef.current === target) {
      return unsubscribe
    }

    previousTargetRef.current = target

    const controls = animate(value, target, SPRING_CONFIG_NUMBER)
    return () => {
      controls.stop()
      unsubscribe()
    }
  }, [target, reduced])

  return display
}
