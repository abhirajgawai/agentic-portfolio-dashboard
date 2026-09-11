/**
 * LiveJobsRow — compact Zerodha/Moomoo snapshot status + on-demand trigger,
 * moved onto the Journey landing page from the old standalone Jobs tab
 * (removed — Groww MF's trigger already lives in the Groww/Sharekhan Data
 * tab's CAS Import section, so nothing there was lost).
 *
 * Deliberately slim — Ledger Gold redesign (design brief §3.1) renders this
 * as small pill chips beside the net-worth hero rather than a boxed Card
 * row, so live-sync status reads as a glance-able status strip, not a
 * competing card on an already busy page.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, Clock, Loader2, RefreshCw } from 'lucide-react'

import { useJobsStatus, triggerSnapshot } from '@/lib/data'
import { cn } from '@/lib/utils'

const DASHBOARD_QUERY_KEYS = ['latest', 'history', 'xirr', 'alerts', 'performance', 'jobs-status'] as const

type JobRun = {
  platform: string
  snapshot_date: string
  status: string
  started_at: string
  rows: number | null
  error: string | null
} | null

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return 'never'
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function statusDot(run: JobRun) {
  if (!run) return { icon: Clock, color: 'text-muted-foreground' }
  if (run.status === 'ok') return { icon: CheckCircle2, color: 'text-gain' }
  if (run.status === 'skipped') return { icon: Clock, color: 'text-warning' }
  return { icon: XCircle, color: 'text-loss' }
}

function LiveJobItem({ platform, label, run }: { platform: 'zerodha' | 'moomoo'; label: string; run: JobRun }) {
  const queryClient = useQueryClient()
  const badge = statusDot(run)
  const Icon = badge.icon

  const mutation = useMutation({
    mutationFn: () => triggerSnapshot(platform),
    onSuccess: () => {
      toast.success(`${label} snapshot complete`)
      for (const key of DASHBOARD_QUERY_KEYS) queryClient.invalidateQueries({ queryKey: [key] })
    },
    onError: (err) => {
      toast.error(`${label} snapshot failed`, { description: err instanceof Error ? err.message : String(err) })
    },
  })

  const isError = run?.status === 'error'

  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-muted/60 py-1 pl-2.5 pr-1 text-[11px]"
      title={run?.error ?? undefined}
    >
      <Icon className={cn('size-3 shrink-0', badge.color)} />
      <span className="font-medium">{label}</span>
      <span className={cn('truncate', isError ? 'text-loss' : 'text-muted-foreground')}>
        {run ? formatWhen(run.started_at) : 'no runs yet'}
      </span>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        title={`Take ${label} snapshot now`}
        className="ml-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-border/60 hover:text-foreground disabled:opacity-50"
      >
        {mutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
      </button>
    </span>
  )
}

export function LiveJobsRow() {
  const jobsQuery = useJobsStatus()
  const jobs = jobsQuery.data?.jobs

  return (
    <div className="flex flex-wrap items-center gap-2">
      <LiveJobItem platform="zerodha" label="Zerodha" run={jobs?.zerodha ?? null} />
      <LiveJobItem platform="moomoo" label="Moomoo" run={jobs?.moomoo ?? null} />
    </div>
  )
}
