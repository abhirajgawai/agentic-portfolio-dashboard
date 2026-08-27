/**
 * Manual Equities screen — one hand-entered TOTAL value per platform for
 * Groww and Sharekhan equities.
 *
 * Neither broker exposes an API/MCP, and there's no per-share feed to
 * itemize against, so this is deliberately a lump-sum "current value"
 * per platform (not a per-ticker holdings list) — updated by hand whenever
 * you check the broker app. Value only (no cost basis) — same convention
 * CAS equities already use.
 *
 * Data source: latest.json holdings where platform is groww/sharekhan AND
 * ticker === 'MANUAL_TOTAL' (the fixed synthetic instrument each platform's
 * value is stored under — see manual_holdings.py).
 * Mutations: POST/DELETE /api/manual-holding (bridge) → re-triggers export_json.py.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { TrendingUp, Loader2, Trash2, Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { formatInrCompact, MASK_TEXT } from '@/lib/format'
import { upsertManualHolding, clearManualHolding, useLatest, type ManualHoldingResponse } from '@/lib/data'
import { usePrivacy } from '@/lib/privacy'
import { cn } from '@/lib/utils'

const MANUAL_TICKER = 'MANUAL_TOTAL'

type Platform = 'groww' | 'sharekhan'
const PLATFORMS: ReadonlyArray<{ id: Platform; label: string }> = [
  { id: 'groww', label: 'Groww' },
  { id: 'sharekhan', label: 'Sharekhan' },
]

function findManualValue(holdings: readonly { platform: string; ticker: string; value: number; asOf: string }[], platform: Platform) {
  return holdings.find((h) => h.platform === platform && h.ticker === MANUAL_TICKER) ?? null
}

function PlatformCard({ platform, label }: { platform: Platform; label: string }) {
  const { data: latest } = useLatest()
  const { masked } = usePrivacy()
  const queryClient = useQueryClient()

  const current = findManualValue(latest?.holdings ?? [], platform)
  const [input, setInput] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [clearConfirm, setClearConfirm] = useState(false)

  // Seed the input from the current value once loaded; don't clobber
  // in-progress typing on background refetches.
  useEffect(() => {
    if (current && input === '') setInput(String(current.value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.value])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['latest'] })
    queryClient.invalidateQueries({ queryKey: ['history'] })
  }

  const setMutation = useMutation({
    mutationFn: () => upsertManualHolding({ platform, value: Number(input) }),
    onSuccess: (res: ManualHoldingResponse) => {
      setMessage({ type: 'success', text: res.result ?? 'Saved' })
      invalidate()
    },
    onError: (err: Error) => setMessage({ type: 'error', text: err.message }),
  })

  const clearMutation = useMutation({
    mutationFn: () => clearManualHolding(platform),
    onSuccess: () => {
      setMessage({ type: 'success', text: `Cleared ${label}` })
      setInput('')
      setClearConfirm(false)
      invalidate()
    },
    onError: (err: Error) => {
      setMessage({ type: 'error', text: err.message })
      setClearConfirm(false)
    },
  })

  const numeric = Number(input)
  const canSave = input.trim() !== '' && Number.isFinite(numeric) && numeric > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <TrendingUp className="size-4" />
            {label}
          </span>
          {current && (
            <span className="text-xs font-normal text-muted-foreground">
              Updated {new Date(current.asOf).toLocaleDateString()}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-xs text-muted-foreground">Current value</div>
          <div className="text-2xl font-semibold tabular-nums">
            {current ? (masked ? MASK_TEXT : formatInrCompact(current.value)) : '—'}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`value-${platform}`}>Update value (₹)</Label>
          <div className="flex gap-2">
            <Input
              id={`value-${platform}`}
              type="number"
              step="any"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. 500000"
            />
            <Button onClick={() => setMutation.mutate()} disabled={!canSave || setMutation.isPending}>
              {setMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            </Button>
          </div>
        </div>

        {message && (
          <Alert className={cn(message.type === 'error' ? 'border-destructive' : '')}>
            {message.type === 'error' ? (
              <>
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{message.text}</AlertDescription>
              </>
            ) : (
              <AlertDescription className="text-green-700">{message.text}</AlertDescription>
            )}
          </Alert>
        )}

        {current && (
          clearConfirm ? (
            <div className="flex items-center gap-2">
              <Button variant="destructive" size="sm" onClick={() => clearMutation.mutate()} disabled={clearMutation.isPending}>
                <Trash2 className="size-3.5 mr-1" />
                Confirm clear
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setClearConfirm(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setClearConfirm(true)}
              disabled={clearMutation.isPending}
            >
              <Trash2 className="size-3.5 mr-1" />
              Clear (fully exited {label})
            </Button>
          )
        )}
      </CardContent>
    </Card>
  )
}

export function ManualEquitiesScreen() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Manual Equities</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Groww and Sharekhan equities — hand-entered total value, no per-share
          breakdown (neither broker exposes an API/MCP). Update whenever you
          check the broker app.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {PLATFORMS.map((p) => (
          <PlatformCard key={p.id} platform={p.id} label={p.label} />
        ))}
      </div>

      <Alert>
        <AlertTitle className="text-sm">Why no per-holding view</AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground">
          Groww and Sharekhan don't expose an API/MCP, so there's no live feed
          to itemize individual stocks against. This total is included in Net
          worth, Allocation, and platform breakdowns like every other holding —
          it's just excluded from the Returns screen (no cost basis, no trade
          history means no return/XIRR math applies to it) and won't show a
          per-ticker breakdown anywhere.
        </AlertDescription>
      </Alert>
    </div>
  )
}
