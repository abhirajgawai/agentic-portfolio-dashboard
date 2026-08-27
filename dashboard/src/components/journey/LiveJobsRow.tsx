/**
 * LiveJobsRow — compact Zerodha/Moomoo snapshot status + on-demand trigger,
 * moved onto the Journey landing page from the old standalone Jobs tab
 * (removed — Groww MF's trigger already lives in the Groww/Sharekhan Data
 * tab's CAS Import section, so nothing there was lost).
 *
 * Deliberately slim (a row, not cards) — Journey is already a busy page;
 * this is a glanceable status strip, not a full dashboard section.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, Clock, Loader2, RefreshCw } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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

  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon className={cn('size-3.5 shrink-0', badge.color)} />
      <span className="font-medium text-xs">{label}</span>
      <span className="text-[11px] text-muted-foreground truncate" title={run?.error ?? undefined}>
        {run ? formatWhen(run.started_at) : 'no runs yet'}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 ml-auto"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        title={`Take ${label} snapshot now`}
      >
        {mutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
      </Button>
    </div>
  )
}

export function LiveJobsRow() {
  const jobsQuery = useJobsStatus()
  const jobs = jobsQuery.data?.jobs

  return (
    <Card className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-6">
      <LiveJobItem platform="zerodha" label="Zerodha" run={jobs?.zerodha ?? null} />
      <div className="hidden h-4 w-px bg-border sm:block" />
      <LiveJobItem platform="moomoo" label="Moomoo" run={jobs?.moomoo ?? null} />
    </Card>
  )
}
