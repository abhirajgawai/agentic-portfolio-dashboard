/**
 * src/components/journey/goals.ts — dashboard-local savings goals.
 *
 * Goals are a dashboard affordance, NOT ledger facts (spec-round2 rationale §3:
 * "goals are a dashboard affordance, not a ledger fact"). They live in
 * localStorage (`dash-goals`), never in the JSON contract.
 *
 * Why this lives INSIDE the journey subtree: `src/lib/goals.ts` is a mid-flight
 * draft owned by the shell/context worker. As it stands it exports no `Goal`
 * type, no named `progress` function, and its hook returns `addGoal`/`recordCrossing`
 * but not the `add`/`remove` the round-2 Goals UI needs — and its "goals" array
 * is rebuilt fresh on every render (adds are lost). The journey UI uses this
 * store instead; when the lib lands a proper store, nothing here conflicts.
 *
 * API (matches what GoalMilestones + JourneyChart use):
 *   - `progress(goal, valueBase)` → clamped fraction 0..1
 *   - `useGoals()` → `{ goals, add, remove }`, localStorage-persisted
 */

import { useCallback, useState } from 'react'

export type Goal = {
  id: string
  label: string
  targetAmount: number
  color: string
  /** ISO timestamp of the first crossing — set by the UI, kept for the chart. */
  crossedAt?: string
}

const STORAGE_KEY = 'dash-goals'

const DEFAULT_GOALS: Goal[] = [
  { id: '1cr-cross', label: 'Cross ₹1Cr', targetAmount: 10_000_000, color: '#6f7cff' },
  { id: 'retirement', label: 'Retirement', targetAmount: 10_000_000, color: '#63d6a5' },
]

function loadGoals(): Goal[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_GOALS
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_GOALS
    return parsed as Goal[]
  } catch {
    // Corrupt or unavailable storage — the defaults still render.
    return DEFAULT_GOALS
  }
}

function saveGoals(goals: Goal[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(goals))
  } catch {
    // Private mode / unavailable storage — the in-memory list still works.
  }
}

/** Progress fraction 0..1, clamped — the shared math for bars and crossings. */
export function progress(goal: Goal, valueBase: number): number {
  if (!Number.isFinite(goal.targetAmount) || goal.targetAmount <= 0) return 0
  return Math.min(valueBase / goal.targetAmount, 1)
}

export function useGoals(): { goals: Goal[]; add: (draft: Omit<Goal, 'id'>) => void; remove: (id: string) => void } {
  const [goals, setGoals] = useState<Goal[]>(loadGoals)

  const add = useCallback((draft: Omit<Goal, 'id'>) => {
    setGoals((prev) => {
      const next = [
        ...prev,
        { id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, ...draft },
      ]
      saveGoals(next)
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setGoals((prev) => {
      const next = prev.filter((goal) => goal.id !== id)
      saveGoals(next)
      return next
    })
  }, [])

  return { goals, add, remove }
}