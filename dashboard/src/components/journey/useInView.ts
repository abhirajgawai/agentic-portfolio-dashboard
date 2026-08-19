/**
 * src/components/journey/useInView.ts — lazy-mount helper for heavy charts.
 *
 * Returns `{ ref, inView }` so a component can mount its ECharts instance only
 * when scrolled into view (motion-spec §9 — nothing animates off-screen). One
 * shared IntersectionObserver via a module-level singleton, per spec-round2 §2.
 *
 * This lives INSIDE the journey subtree (not `src/lib/useIntersectionObserver.ts`)
 * because that lib file is mid-refactor: it currently exports a boolean-style
 * `useIntersectionObserver(ref, opts)` hook with unimported React references and
 * no `useInView` export, and it is owned by the shell/context worker. The
 * journey components must compile and run against the current tree, so they use
 * this self-contained hook; when the lib lands the real `useInView`, nothing
 * here conflicts (the subtree simply keeps its own).
 */

import { useEffect, useRef, useState, type RefObject } from 'react'

export type InViewResult<T extends HTMLElement> = {
  ref: RefObject<T | null>
  inView: boolean
}

let sharedObserver: IntersectionObserver | null = null
const listeners = new Map<Element, (visible: boolean) => void>()

function observe(element: Element, onVisible: (visible: boolean) => void): void {
  listeners.set(element, onVisible)
  if (sharedObserver === null) {
    sharedObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const callback = listeners.get(entry.target)
        if (callback) callback(entry.isIntersecting)
      }
    })
  }
  sharedObserver.observe(element)
}

function unobserve(element: Element): void {
  listeners.delete(element)
  sharedObserver?.unobserve(element)
}

export function useInView<T extends HTMLElement>(): InViewResult<T> {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    observe(element, setInView)
    return () => unobserve(element)
  }, [])

  return { ref, inView }
}