/**
 * Milestone journal — the DOM-readable record of deterministic narration
 * computed by ./journal (platform first appearances, ₹10L threshold crossings,
 * largest moves). Seeded into localStorage (`dash-journal`) on first run;
 * afterwards the user's deletions persist while NEW milestones are appended
 * (the seed stays fresh without undoing edits).
 *
 * Per a11y-spec §5 the JourneyChart is decoration — this list (and
 * GoalMilestones) carries the same facts as readable DOM.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'

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
import type { History } from '@/types/contract'
import { deriveJournalEntries, formatShortDate, type JournalEntry } from './journal'

/* ------------------------------------------------------------------ */
/* localStorage persistence                                            */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'dash-journal'
const JOURNAL_VERSION = 2 // increment when derivation logic changes to force reseed

type StoredJournal = { version: number; seededAt: string; entries: JournalEntry[] }

function loadStored(): JournalEntry[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredJournal
    if (parsed.version !== JOURNAL_VERSION) return null // derivation changed → full reseed
    if (!Array.isArray(parsed.entries)) return null
    const out: JournalEntry[] = []
    for (const e of parsed.entries as unknown[]) {
      const row = e as Partial<JournalEntry> | null
      if (
        row &&
        typeof row.id === 'string' &&
        typeof row.date === 'string' &&
        typeof row.description === 'string'
      ) {
        out.push({ id: row.id, date: row.date, description: row.description })
      }
    }
    return out
  } catch {
    return null
  }
}

function persistJournal(entries: JournalEntry[]): void {
  try {
    const payload: StoredJournal = { version: JOURNAL_VERSION, seededAt: new Date().toISOString(), entries }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Private mode / unavailable storage — the in-memory list still works.
  }
}

/* ------------------------------------------------------------------ */
/* Manage dialog                                                       */
/* ------------------------------------------------------------------ */

function ManageDialog({
  open,
  onOpenChange,
  entries,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: JournalEntry[]
  onDelete: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Journal entries</DialogTitle>
          <DialogDescription>
            Delete entries you don't want — everything else stays in this browser.
          </DialogDescription>
        </DialogHeader>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">No entries.</p>
        ) : (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2 text-xs"
              >
                <span className="min-w-0">
                  <span className="block tabular-nums text-muted-foreground">
                    {formatShortDate(entry.date)}
                  </span>
                  <span className="block truncate">{entry.description}</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  onClick={() => onDelete(entry.id)}
                  aria-label={`Delete entry: ${entry.description}`}
                >
                  <Trash2 className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function MilestoneJournal({ history }: { history: History }) {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [manageOpen, setManageOpen] = useState(false)
  const storedRef = useRef<JournalEntry[] | null>(null)

  const derived = useMemo(() => deriveJournalEntries(history), [history])

  // Seed/merge on first mount; appends new milestones, never resurrects deleted ones.
  useEffect(() => {
    if (derived.length === 0) return
    if (storedRef.current === null) storedRef.current = loadStored()
    const stored = storedRef.current
    const merged = stored
      ? [...stored, ...derived.filter((d) => !stored.some((s) => s.id === d.id))]
      : derived
    setEntries(merged)
    if (!stored || merged.length > stored.length) persistJournal(merged)
  }, [derived])

  const deleteEntry = (id: string) => {
    setEntries((prev) => {
      const next = prev.filter((entry) => entry.id !== id)
      persistJournal(next)
      return next
    })
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Milestone journal</h3>
            <p className="text-[11px] text-muted-foreground">computed from the ledger</p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            onClick={() => setManageOpen(true)}
            aria-label="Manage journal entries"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        {entries.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
            No milestones yet — they appear here as the ledger grows
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-2 text-[11px]">
                <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
                  {formatShortDate(entry.date)}
                </span>
                <span className="min-w-0">{entry.description}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ManageDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        entries={entries}
        onDelete={deleteEntry}
      />
    </Card>
  )
}
