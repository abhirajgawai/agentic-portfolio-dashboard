/**
 * src/lib/useIntersectionObserver.ts — Lazy-mount heavy charts/sparklines
 * when scrolled into view. One shared IntersectionObserver via a module-level
 * singleton; each element registers its own callback in a Map, so one element
 * becoming visible can never flip another component's state (the original
 * singleton captured the first caller's setState closure — fixed).
 *
 * Two hooks, same engine:
 *   - useIntersectionObserver(ref, { root, rootMargin, threshold }) => boolean
 *     (ref-based — you already own the ref; workspaces/JourneyWorkspace uses it)
 *   - useInView<T>(options?) => { ref, inView }
 *     (returns the ref to attach; journey/JourneyChart + AccountRoads use it)
 *
 * Both observe once and un-observe after the first intersection — charts stay
 * mounted after they appear (they only lazily MOUNT; they don't unmount).
 */

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

export type IntersectionOptions = {
  root?: Element | null
  rootMargin?: string
  threshold?: number
}

/** One observer per app, created with the first caller's options (all current
 *  consumers use the same defaults; per-call root/rootMargin variance is not
 *  supported by a shared observer by design). */
let sharedObserver: IntersectionObserver | null = null

/** Element → callback registry. The callback fires once, then the element is
 *  un-observed and removed (the entry only re-observes if the ref changes). */
const onVisibleByElement = new Map<Element, () => void>()

function ensureObserver({ root, rootMargin, threshold }: IntersectionOptions): IntersectionObserver {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const onVisible = onVisibleByElement.get(entry.target)
          if (!onVisible) continue
          onVisibleByElement.delete(entry.target)
          sharedObserver?.unobserve(entry.target)
          onVisible()
        }
      },
      {
        root: root ?? null,
        rootMargin: rootMargin ?? '0px',
        threshold: threshold ?? 0.1,
      },
    )
  }
  return sharedObserver
}

/** Observe `ref.current`; returns true once it intersects the viewport (sticky). */
export function useIntersectionObserver<T extends HTMLElement>(
  ref: RefObject<T | null>,
  options: IntersectionOptions = {},
): boolean {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = ensureObserver(options)
    onVisibleByElement.set(element, () => setIsVisible(true))
    observer.observe(element)

    return () => {
      onVisibleByElement.delete(element)
      observer.unobserve(element)
    }
    // Primitive deps only — an inline `{ threshold: 0.1 }` object is stable across renders.
  }, [ref, options.root, options.rootMargin, options.threshold])

  return isVisible
}

/** useInView — convenience variant that owns the ref: `const { ref, inView } = useInView<HTMLDivElement>()`. */
export function useInView<T extends HTMLElement>(options: IntersectionOptions = {}) {
  const ref = useRef<T | null>(null)
  const inView = useIntersectionObserver<T>(ref, options)
  return { ref, inView }
}