import { Minus, TrendingDown, TrendingUp } from "lucide-react"

import { formatInrCompact, MASK_TEXT } from "@/lib/format"
import { cn } from "@/lib/utils"
import { formatShortDate } from "./journal"

export interface DeltaChipRailProps {
  dates: readonly string[]
  values: readonly number[]
  masked: boolean
}

export function DeltaChipRail({ dates, values, masked }: DeltaChipRailProps) {
  if (values.length < 2) return null

  return (
    <div className="flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="Adjacent day changes">
      {values.slice(1).map((value, index) => {
        const previous = values[index] ?? value
        const delta = value - previous
        const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus
        const deltaClass = delta > 0 ? "text-gain" : delta < 0 ? "text-loss" : "text-muted-foreground"
        const date = dates[index + 1]

        return (
          <span
            key={`${date ?? index}-${index}`}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
              deltaClass
            )}
          >
            <Icon className="size-3 shrink-0" aria-hidden="true" />
            <span>{date ? formatShortDate(date) : "—"}</span>
            <span className="font-medium tabular-nums">
              {masked ? MASK_TEXT : delta === 0 ? "—" : `${delta > 0 ? "+" : ""}${formatInrCompact(delta)}`}
            </span>
          </span>
        )
      })}
    </div>
  )
}
