/**
 * SegmentReconcileBar — the two identity checks below the card grid
 * (spec-round2/segments-workspace §5). Makes the partition invariants VISIBLY
 * true: US + India = Consolidated (geography partition of one holdings array)
 * and Groww + Sharekhan = Groww-CAS (definitional union). Both checks are
 * GENUINE invariants: the left sides are summed independently from the raw
 * contract holdings in assertReconciliation (casSum/casRawCount are
 * recomputed from latest.holdings, never reused from the cas segment's own
 * filtered rows), and equality is asserted with the INR epsilon there. A
 * mismatch renders amber "differs by ₹X" — never silently resolved.
 *
 * A11y (spec §5 + §7.2): the strip is a <ul> of identity lines inside one
 * role="status" aria-live="polite" container — announced once on workspace
 * mount and once per refresh (final values only; the 400ms opacity re-check
 * fade is motion-only). The ✓ is TEXT, not icon-only.
 */

import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatInrCompact } from '@/lib/format'
import type { SegmentReconciliation, SegmentSummary } from '@/lib/segments'
import { cn } from '@/lib/utils'

interface SegmentReconcileBarProps {
  segments: readonly SegmentSummary[]
  reconciliation: SegmentReconciliation
}

export function SegmentReconcileBar({ segments, reconciliation }: SegmentReconcileBarProps) {
  const byId = new Map(segments.map((s) => [s.id, s]))
  const us = byId.get('us')
  const india = byId.get('india')
  const cas = byId.get('cas')
  const consolidated = byId.get('consolidated')

  // Identity-2 left side: per-platform sums over the CAS members (pure, 5 lines).
  const groww = (cas?.holdings ?? [])
    .filter((h) => h.platform === 'groww')
    .reduce((sum, h) => sum + h.valueBase, 0)
  const sharekhan = (cas?.holdings ?? [])
    .filter((h) => h.platform === 'sharekhan')
    .reduce((sum, h) => sum + h.valueBase, 0)

  const ok1 = reconciliation.matches.usPlusIndiaEqConsolidated
  // Both identities are genuine now: casSum is recomputed from the RAW
  // latest.holdings in assertReconciliation, and the COUNT must agree too.
  const ok2 =
    reconciliation.matches.casEqGrowwSharekhan &&
    reconciliation.matches.casCountEqGrowwSharekhan
  const diff1 = Math.abs(reconciliation.usPlusIndia - reconciliation.consolidated)
  const diff2 = Math.abs(reconciliation.casSum - reconciliation.casValueBase)

  // Re-check fade on data change (motion-spec: strip 400ms opacity-only).
  const sig = `${reconciliation.usPlusIndia}|${reconciliation.consolidated}|${reconciliation.casSum}`
  const [faded, setFaded] = useState(false)
  useEffect(() => {
    setFaded(true)
    const t = window.setTimeout(() => setFaded(false), 50)
    return () => window.clearTimeout(t)
  }, [sig])

  const c = (v: number) => formatInrCompact(v)

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs transition-opacity duration-[400ms]',
        faded ? 'opacity-50' : 'opacity-100',
      )}
    >
      <ul role="status" aria-live="polite" className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <li className="flex flex-wrap items-center gap-x-1.5 tabular-nums">
          <span>US {c(us?.valueBase ?? 0)}</span>
          <span className="text-muted-foreground">+</span>
          <span>India {c(india?.valueBase ?? 0)}</span>
          <span className="text-muted-foreground">=</span>
          <span className="font-medium">{c(consolidated?.valueBase ?? 0)}</span>
          <span
            className={cn(
              'font-medium',
              ok1 ? 'text-gain' : 'text-warning',
            )}
          >
            {ok1 ? '✓ sums match' : `⚠ differs by ${c(diff1)}`}
          </span>
        </li>
        <li className="flex flex-wrap items-center gap-x-1.5 tabular-nums">
          <span>Groww {c(groww)}</span>
          <span className="text-muted-foreground">+</span>
          <span>Sharekhan {c(sharekhan)}</span>
          <span className="text-muted-foreground">=</span>
          <span className="font-medium">{c(cas?.valueBase ?? 0)}</span>
          <span
            className={cn(
              'font-medium',
              ok2 ? 'text-gain' : 'text-warning',
            )}
          >
            {ok2
              ? '✓ sums match'
              : reconciliation.matches.casEqGrowwSharekhan
                ? `⚠ count differs (${reconciliation.casRawCount} raw vs ${reconciliation.casCount} in segment)`
                : `⚠ differs by ${c(diff2)}`}
          </span>
        </li>
      </ul>

      {/* Footnote (spec §5) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help items-center gap-1 text-muted-foreground">
            <Info className="size-3.5" />
            <span className="sr-only">Reconciliation footnote</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-72 py-1 text-xs">
          Segments are derived client-side from the latest export — identities hold exactly. Day P&L
          covers live legs only; CAS legs re-price on monthly import.
        </TooltipContent>
      </Tooltip>
    </div>
  )
}