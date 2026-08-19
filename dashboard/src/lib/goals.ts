/**
 * src/lib/goals.ts — localStorage-backed savings goals: [{id, label, targetAmount, color}].
 * Pure CRUD + progress(goal, valueBase) → clamp(valueBase/targetAmount) as a
 * FRACTION (0..1) — the journey/GoalMilestones contract (`progress * 100`,
 * `progress < 1`). Goals are dashboard-local affordances, never ledger facts.
 *
 * Hook contract (superset of all consumers — all optional members):
 *   useGoals(initialGoals?) => {
 *     goals: Goal[],
 *     journal: JournalEntry[],
 *     addGoal(draft): Goal            // workspaces/JourneyWorkspace contract
 *     recordCrossing(amount): void    // stamps crossedAt + journal entry
 *     add(draft): Goal                // journey/GoalMilestones alias for addGoal
 *     remove(id): void                // journey/GoalMilestones
 *     progress(goal, valueBase): number  // fraction 0..1
 *   }
 * Plus the named export `progress` (journey/GoalMilestones imports it directly)
 * and the `Goal` / `JournalEntry` types.
 */

import { useEffect, useState } from 'react'

import { formatInrCompact } from '@/lib/format'

export type Goal = {
  id: string // unique e.g. '1cr-cross', 'retirement'
  label: string
  targetAmount: number
  color: string // css color string
  crossedAt?: string // ISO when first crossed
}

export type JournalEntry = {
  date: string // ISO date string
  label: string // e.g. "crossed ₹1Cr"
}

const DEFAULT_GOALS: Goal[] = [
  { id: '1cr-cross', label: 'Cross ₹1Cr', targetAmount: 10_000_000, color: '#3b82f6' },
  { id: 'retirement', label: 'Retirement', targetAmount: 10_000_000, color: '#10b981' },
]

const GOALS_KEY = 'portfolio.goals'
const JOURNAL_KEY = 'portfolio.journal'

/** Read one localStorage key; any parse error / unavailable storage → fallback. */
function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T) : fallback
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable — in-memory state still works for this session */
  }
}

/** Fraction of the target reached, clamped to [0, 1]. 0-target goals → 0. */
export function progress(goal: Goal, valueBase: number): number {
  if (goal.targetAmount <= 0) return 0
  return Math.min(valueBase / goal.targetAmount, 1)
}

export function useGoals(initialGoals?: Goal[]) {
  // Prefer persisted goals, else the provided/seed goals, else the defaults.
  const [goals, setGoals] = useState<Goal[]>(() => {
    const stored = readStorage<Goal[]>(GOALS_KEY, [])
    if (stored.length > 0) return stored
    return initialGoals && initialGoals.length > 0 ? [...initialGoals] : [...DEFAULT_GOALS]
  })
  const [journal, setJournal] = useState<JournalEntry[]>(() => readStorage<JournalEntry[]>(JOURNAL_KEY, []))

  // Persist on every change.
  useEffect(() => writeStorage(GOALS_KEY, goals), [goals])
  useEffect(() => writeStorage(JOURNAL_KEY, journal), [journal])

  /** Add a goal; returns the created Goal (workspaces/GoalMilestones uses the return). */
  const addGoal = (g: Omit<Goal, 'id'>): Goal => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const newGoal: Goal = { id, ...g }
    setGoals((prev) => [...prev, newGoal])
    return newGoal
  }

  const remove = (id: string): void => {
    setGoals((prev) => prev.filter((g) => g.id !== id))
  }

  /** Stamp the first uncrossed goal whose target is now reached + journal it. */
  const recordCrossing = (amount: number): void => {
    const crossed = goals.find((g) => !g.crossedAt && g.targetAmount <= amount)
    if (!crossed) return

    setGoals((prev) => prev.map((g) => (g.id === crossed.id ? { ...g, crossedAt: new Date().toISOString() } : g)))

    const entry: JournalEntry = {
      date: new Date().toISOString(),
      label: `${crossed.label} — crossed ₹${formatInrCompact(amount)}`,
    }
    setJournal((prev) => (prev.some((j) => j.label === entry.label) ? prev : [entry, ...prev].slice(0, 20)))
  }

  return {
    goals,
    journal,
    addGoal,
    recordCrossing,
    add: addGoal,
    remove,
    progress,
  }
}