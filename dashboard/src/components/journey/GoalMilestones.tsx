/**
 * Goal milestones — savings goals backed by the portfolio SQLite DB (M8.9):
 * reads goals.json (the 6th contract file) via useGoalsData(), and creates /
 * updates / deletes through the bridge (`POST|PATCH|DELETE /api/goals`),
 * invalidating the ['goals'] query after each mutation and reloading the page
 * once the bridge has regenerated the export. Progress is NEVER
 * stored — each row derives it from the valueBase prop (min(value/target,1)).
 * Crossing a goal fires ONE sonner toast, acked in localStorage
 * (`dash-goal-acked:<dbId>`) so it never re-fires; the crossed card stays
 * highlighted. Edit is a REAL partial PATCH (the old remove+re-add hack is
 * gone); add/edit via a shadcn dialog with a chart-palette color pick.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { getChartPalette } from '@/components/charts/options'
import { createGoal, deleteGoal, updateGoal, getHealth } from '@/lib/api'
import { useGoalsData } from '@/lib/data'
import type { GoalUpdateInput } from '@/types/bridge'
import type { Goal } from '@/types/contract'
import { formatInrCompact, MASK_TEXT } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { useBackendHealth } from '@/lib/useBackendHealth'
import { cn } from '@/lib/utils'
import { SPRING_CONFIG_MILESTONE_POP, usePrefersReducedMotion } from './motion'
import { EmptyGlyph } from './EmptyGlyph'

/* ------------------------------------------------------------------ */
/* Progress math — derived at render time, never stored                */
/* ------------------------------------------------------------------ */

/** Fraction of the target reached, clamped to [0, 1]. */
function progress(goal: Goal, valueBase: number): number {
  if (!Number.isFinite(goal.targetAmount) || goal.targetAmount <= 0) return 0
  return Math.min(valueBase / goal.targetAmount, 1)
}

/* ------------------------------------------------------------------ */
/* Crossing ack — one toast per goal, forever (localStorage, keyed     */
/* on the STABLE numeric DB id)                                        */
/* ------------------------------------------------------------------ */

const ACK_PREFIX = 'dash-goal-acked:'

function readAck(id: number): boolean {
  try {
    return window.localStorage.getItem(ACK_PREFIX + id) === 'true'
  } catch {
    return false
  }
}

function writeAck(id: number): void {
  try {
    window.localStorage.setItem(ACK_PREFIX + id, 'true')
  } catch {
    // Storage unavailable — the in-memory ref still dedupes this session.
  }
}

/** Fire the crossing toast once per goal; never twice for the same goal. */
function useGoalCrossing(goals: Goal[], valueBase: number): string | null {
  const ackedRef = useRef<Record<string, boolean>>({})
  const timeoutRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const [justCrossedGoalId, setJustCrossedGoalId] = useState<string | null>(null)

  // Keep dependency changes from cancelling the one-shot pop reset. The guard
  // makes the timer safe if the component unmounts before it fires.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    for (const goal of goals) {
      if (progress(goal, valueBase) < 1) continue
      if (ackedRef.current[goal.id] !== undefined) continue
      if (!readAck(goal.id)) {
        toast(`Goal reached: ${goal.label}`, {
          description: `Portfolio value hit the ${formatInrCompact(goal.targetAmount)} target`,
        })
        writeAck(goal.id)
        setJustCrossedGoalId(String(goal.id))
        if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
        timeoutRef.current = window.setTimeout(() => {
          timeoutRef.current = null
          if (mountedRef.current) setJustCrossedGoalId(null)
        }, 600)
      }
      ackedRef.current[goal.id] = true
    }
  }, [goals, valueBase])

  return justCrossedGoalId
}

/* ------------------------------------------------------------------ */
/* Add/edit dialog                                                     */
/* ------------------------------------------------------------------ */

type GoalDraft = Omit<Goal, 'id' | 'crossedAt'>

function GoalDialog({
  open,
  onOpenChange,
  editing,
  pending,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: Goal | null
  pending: boolean
  onSave: (draft: GoalDraft) => void
}) {
  const palette = useMemo(() => getChartPalette(), [])
  const defaultColor = palette[0] ?? '#6f7cff'

  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [color, setColor] = useState(defaultColor)

  // Reset the form whenever the dialog opens (for add or edit).
  useEffect(() => {
    setLabel(editing?.label ?? '')
    setAmount(editing ? String(editing.targetAmount) : '')
    setColor(editing?.color ?? defaultColor)
  }, [open, editing, defaultColor])

  const amountNum = Number(amount)
  const valid = label.trim().length > 0 && Number.isFinite(amountNum) && amountNum > 0

  const submit = () => {
    if (!valid) return
    onSave({ label: label.trim(), targetAmount: amountNum, color })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit goal' : 'Add a goal'}</DialogTitle>
          <DialogDescription>
            Goals are saved to your portfolio database via the local bridge —
            they persist across browsers and dashboard reinstalls.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="goal-label">Label</Label>
            <Input
              id="goal-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="First ₹1Cr"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-amount">Target amount (₹)</Label>
            <Input
              id="goal-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="10000000"
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium" id="goal-color-label">
              Color
            </span>
            <div role="group" aria-labelledby="goal-color-label" className="flex flex-wrap gap-1.5">
              {palette.map((c, index) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={color === c}
                  aria-label={`Color ${index + 1}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    'size-6 rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    color === c ? 'scale-110 border-ring' : 'border-transparent',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              {editing ? 'Save' : 'Add goal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function GoalMilestones({ valueBase }: { valueBase: number }) {
  const queryClient = useQueryClient()
  const goalsQuery = useGoalsData()
  const { masked } = usePrivacy()
  const health = useBackendHealth()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)
  const reduced = usePrefersReducedMotion()

  const goals = goalsQuery.data?.goals ?? []

  // Every mutation re-reads goals.json on success (the bridge regenerates it).
  const invalidateGoals = () => {
    void queryClient.invalidateQueries({ queryKey: ['goals'] })
  }

  // Wait for the bridge to finish regenerating exports, then reload.
  // Captures the current export stamp, then polls getHealth() until it advances.
  const reloadAfterMutation = async () => {
    const baseline = health.exportsGeneratedAt
    if (!baseline) {
      // No baseline — just reload (fallback)
      window.location.reload()
      return
    }
    // Poll for the export stamp to advance (new export written)
    const maxAttempts = 30 // ~30 seconds max
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        const h = await getHealth()
        if (h.pipeline.exportsGeneratedAt && h.pipeline.exportsGeneratedAt !== baseline) {
          window.location.reload()
          return
        }
      } catch {
        // Ignore fetch errors, keep polling
      }
    }
    // Timeout — reload anyway
    window.location.reload()
  }

  const createMutation = useMutation({
    mutationFn: createGoal,
    onSuccess: async () => {
      invalidateGoals()
      setDialogOpen(false)
      await reloadAfterMutation()
    },
    onError: (err: Error) => toast.error(`Could not add goal — ${err.message}`),
  })

  const updateMutation = useMutation({
    mutationFn: (input: { id: number; patch: GoalUpdateInput }) => updateGoal(input.id, input.patch),
    onSuccess: async () => {
      invalidateGoals()
      setDialogOpen(false)
      await reloadAfterMutation()
    },
    onError: (err: Error) => toast.error(`Could not save goal — ${err.message}`),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteGoal,
    onSuccess: async () => {
      invalidateGoals()
      await reloadAfterMutation()
    },
    onError: (err: Error) => toast.error(`Could not delete goal — ${err.message}`),
  })

  const dialogPending = createMutation.isPending || updateMutation.isPending
  const rowsPending = dialogPending || deleteMutation.isPending

  const justCrossedGoalId = useGoalCrossing(goals, valueBase)

  const openAdd = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (goal: Goal) => {
    setEditing(goal)
    setDialogOpen(true)
  }

  // Edit is a REAL partial PATCH against the stable DB id — no remove+re-add,
  // so the id (and its crossing ack) survives every edit.
  const handleSave = (draft: GoalDraft) => {
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        patch: { label: draft.label, targetAmount: draft.targetAmount, color: draft.color },
      })
    } else {
      createMutation.mutate(draft)
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Goals</h3>
            <p className="text-[11px] text-muted-foreground">saved to your portfolio database</p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            onClick={openAdd}
            aria-label="Add goal"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>

        {goalsQuery.isLoading ? (
          <div className="mt-3 space-y-2.5" aria-busy="true" aria-label="Loading goals">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : goalsQuery.isError ? (
          <p className="mt-4 rounded-md border border-dashed border-destructive/40 p-3 text-center text-[11px] text-muted-foreground">
            Goals unavailable — run the pipeline export or check the bridge
          </p>
        ) : goals.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
            <span className="flex flex-col items-center gap-2">
              <EmptyGlyph className="h-10 w-16" />
              <span>No goals yet — set a target to watch</span>
            </span>
          </p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {goals.map((goal) => {
              const pctComplete = Math.round(progress(goal, valueBase) * 100)
              const reached = pctComplete >= 100
              return (
                <li
                  key={goal.id}
                  className={cn(
                    'rounded-md border p-2.5',
                    reached ? 'border-gain/30 bg-gain/5' : 'border-border',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: goal.color }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{goal.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      {reached && (
                        reduced || justCrossedGoalId !== String(goal.id) ? (
                          <Badge variant="success" className="px-1.5 py-0 text-[10px]">
                            Reached
                          </Badge>
                        ) : (
                          <motion.span
                            key={justCrossedGoalId}
                            initial={{ scale: 1 }}
                            animate={{ scale: [1, 1.15, 1] }}
                            transition={SPRING_CONFIG_MILESTONE_POP}
                            className="inline-flex"
                          >
                            <Badge variant="success" className="px-1.5 py-0 text-[10px]">
                              Reached
                            </Badge>
                          </motion.span>
                        )
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        onClick={() => openEdit(goal)}
                        disabled={rowsPending}
                        aria-label={`Edit ${goal.label}`}
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        onClick={() => deleteMutation.mutate(goal.id)}
                        disabled={rowsPending}
                        aria-label={`Delete ${goal.label}`}
                      >
                        {deleteMutation.isPending ? (
                          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="size-3" />
                        )}
                      </Button>
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Progress
                      value={Math.min(pctComplete, 100)}
                      className="h-1.5 flex-1"
                      aria-label={`${Math.min(pctComplete, 100)} percent toward target`}
                    />
                    <span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                      {reached ? '100%' : `${pctComplete}%`} there
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                    target {masked ? MASK_TEXT : formatInrCompact(goal.targetAmount)}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
      <GoalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        pending={dialogPending}
        onSave={handleSave}
      />
    </Card>
  )
}
