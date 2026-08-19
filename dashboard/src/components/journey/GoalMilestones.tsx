/**
 * Goal milestones — dashboard-local savings goals (localStorage via ./goals,
 * NOT ledger facts — rationale §3). Each row shows the label,
 * target, progress vs the current portfolio value and "% there". Crossing a
 * goal fires ONE sonner toast, acked in localStorage (`dash-goal-acked:<id>`)
 * so it never re-fires; the crossed card stays highlighted. Add/edit via a
 * shadcn dialog with a chart-palette color pick.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
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
import { getChartPalette } from '@/components/charts/options'
import { progress, useGoals, type Goal } from './goals'
import { formatInrCompact, MASK_TEXT } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Crossing ack — one toast per goal, forever (localStorage)           */
/* ------------------------------------------------------------------ */

const ACK_PREFIX = 'dash-goal-acked:'

function readAck(id: string): boolean {
  try {
    return window.localStorage.getItem(ACK_PREFIX + id) === 'true'
  } catch {
    return false
  }
}

function writeAck(id: string): void {
  try {
    window.localStorage.setItem(ACK_PREFIX + id, 'true')
  } catch {
    // Storage unavailable — the in-memory ref still dedupes this session.
  }
}

/** Fire the crossing toast once per goal; never twice for the same goal. */
function useGoalCrossing(goals: Goal[], valueBase: number): void {
  const ackedRef = useRef<Record<string, boolean>>({})
  useEffect(() => {
    for (const goal of goals) {
      if (progress(goal, valueBase) < 1) continue
      if (ackedRef.current[goal.id] !== undefined) continue
      if (!readAck(goal.id)) {
        toast(`Goal reached: ${goal.label}`, {
          description: `Portfolio value hit the ${formatInrCompact(goal.targetAmount)} target`,
        })
        writeAck(goal.id)
      }
      ackedRef.current[goal.id] = true
    }
  }, [goals, valueBase])
}

/* ------------------------------------------------------------------ */
/* Add/edit dialog                                                     */
/* ------------------------------------------------------------------ */

type GoalDraft = Omit<Goal, 'id'>

function GoalDialog({
  open,
  onOpenChange,
  editing,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: Goal | null
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
            Goals live only in this browser (rationale §3) — they are dashboard
            affordances, not ledger facts.
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
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
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
  const { goals, add, remove } = useGoals()
  const { masked } = usePrivacy()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)

  useGoalCrossing(goals, valueBase)

  const openAdd = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (goal: Goal) => {
    setEditing(goal)
    setDialogOpen(true)
  }

  const handleSave = (draft: GoalDraft) => {
    if (editing) remove(editing.id) // the goals lib has no update — remove + re-add
    add(draft)
    setDialogOpen(false)
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Goals</h3>
            <p className="text-[11px] text-muted-foreground">local to this dashboard</p>
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

        {goals.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
            No goals yet — set a target to watch
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
                        <Badge variant="success" className="px-1.5 py-0 text-[10px]">
                          Reached
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        onClick={() => openEdit(goal)}
                        aria-label={`Edit ${goal.label}`}
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        onClick={() => remove(goal.id)}
                        aria-label={`Delete ${goal.label}`}
                      >
                        <Trash2 className="size-3" />
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
        onSave={handleSave}
      />
    </Card>
  )
}
