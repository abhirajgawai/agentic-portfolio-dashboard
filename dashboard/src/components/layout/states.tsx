import { AlertTriangle, Inbox, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/** Full-area loading state (skeleton cards matching the overview layout). */
export function LoadingState({ label = 'Loading data…' }: { label?: string }) {
  return (
    <div className="space-y-4" role="status" aria-label={label}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-40" />
            <Skeleton className="mt-2 h-3 w-28" />
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <Skeleton className="h-64 w-full" />
      </Card>
    </div>
  )
}

/** Full-area error state with a retry button (TanStack Query refetch). */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <Card className="flex flex-col items-center gap-3 border-loss/30 bg-loss/5 p-8 text-center">
      <AlertTriangle className="size-8 text-loss" />
      <div>
        <p className="text-sm font-medium">Could not load dashboard data</p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </Card>
  )
}

/** Empty state — every screen renders one when its data array is empty. */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
}: {
  title: string
  description: string
  icon?: typeof Inbox
}) {
  return (
    <Card className="flex flex-col items-center gap-2 p-10 text-center">
      <Icon className="size-7 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
    </Card>
  )
}

/** Small inline spinner for buttons/refresh actions. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={className ?? 'size-4 animate-spin'} />
}