"use client"

import * as React from "react"
import { animate } from "motion"
import { MASK_TEXT } from "@/lib/format"
import { usePrivacy } from "@/lib/privacy"
import type { Milestone } from "./journal"
import { SPRING_CONFIG_MILESTONE_POP, usePrefersReducedMotion } from "./motion"

function candidateMilestoneIds(milestones: Milestone[]): Set<string> {
  const crossings = milestones
    .filter((milestone) => milestone.description.startsWith("Crossed"))
    .sort((a, b) => b.value - a.value || b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  if (crossings.length > 0) return new Set(crossings.slice(0, 2).map((milestone) => milestone.id))

  const latestAth = milestones
    .filter((milestone) => milestone.description.startsWith("New all-time high"))
    .sort((a, b) => b.date.localeCompare(a.date) || b.value - a.value || a.id.localeCompare(b.id))[0]
  return latestAth ? new Set([latestAth.id]) : new Set()
}

/** Rough SVG text width at fontSize 10/weight 600 — enough to detect overlap, not to typeset. */
function estimateLabelWidth(text: string): number {
  return text.length * 5.6 + 6
}

const LABEL_GAP_PX = 6

/**
 * Milestone labels and the chart's own per-point value labels share the same
 * (x, y - ~11) neighborhood whenever a milestone lands on a real snapshot
 * date — which is the common case, not an edge case, since milestones are
 * derived from the same ledger. Two independent label systems drawing at a
 * fixed offset with no mutual awareness renders as overlapping/garbled text.
 * This is the single source of truth for "which milestones get a label" so
 * JourneyChart can suppress its own point label at the same dates.
 */
export function selectVisibleMilestoneLabels(
  milestones: Milestone[],
  xScale: (date: Date) => number
): Set<string> {
  const candidates = candidateMilestoneIds(milestones)
  const kept = new Set<string>()
  let lastX: number | null = null
  let lastHalfWidth = 0
  for (const milestone of milestones) {
    if (!candidates.has(milestone.id)) continue
    const x = xScale(new Date(`${milestone.date}T00:00:00Z`))
    const halfWidth = estimateLabelWidth(milestone.description) / 2
    if (lastX !== null && x - halfWidth < lastX + lastHalfWidth + LABEL_GAP_PX) continue
    kept.add(milestone.id)
    lastX = x
    lastHalfWidth = halfWidth
  }
  return kept
}

/** Clamp a centered SVG text label so it never renders past the chart edges. */
export function clampedLabelAnchor(
  x: number,
  plotWidth: number,
  halfWidth = 30
): { x: number; textAnchor: "start" | "middle" | "end" } {
  const pad = 4
  if (x - halfWidth < pad) return { x: pad, textAnchor: "start" }
  if (x + halfWidth > plotWidth - pad) return { x: plotWidth - pad, textAnchor: "end" }
  return { x, textAnchor: "middle" }
}

function MilestoneDot({
  milestone,
  active,
  justCrossed,
  reduced,
}: {
  milestone: Milestone
  active: boolean
  justCrossed: boolean
  reduced: boolean
}) {
  const [scale, setScale] = React.useState(1)
  const previousTrigger = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (reduced || !justCrossed || previousTrigger.current === milestone.date) {
      if (reduced) setScale(1)
      return
    }
    previousTrigger.current = milestone.date
    const controls = animate(1, [1.15, 1], {
      ...SPRING_CONFIG_MILESTONE_POP,
      onUpdate: setScale,
    })
    return () => controls.stop()
  }, [justCrossed, milestone.date, reduced])

  return (
    <circle
      r={active ? 6 : 5}
      fill="var(--primary)"
      filter="url(#journey-glow)"
      transform={`scale(${scale})`}
      opacity={active ? 1 : 0.9}
    />
  )
}

export function MilestonePins({
  milestones,
  xScale,
  yScale,
  plotWidth,
  activeDate,
  justCrossedDate,
}: {
  milestones: Milestone[]
  xScale: (date: Date) => number
  yScale: (value: number) => number
  plotWidth: number
  activeDate?: string
  justCrossedDate?: string | null
}) {
  const reduced = usePrefersReducedMotion()
  const { masked } = usePrivacy()
  const labelIds = React.useMemo(() => selectVisibleMilestoneLabels(milestones, xScale), [milestones, xScale])

  if (milestones.length === 0) return null

  return (
    <g aria-label="Portfolio milestones">
      {milestones.map((milestone) => {
        const x = xScale(new Date(`${milestone.date}T00:00:00Z`))
        const y = yScale(milestone.value)
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null
        const significant = labelIds.has(milestone.id)
        return (
          <g key={milestone.id} transform={`translate(${x}, ${y})`}>
            <MilestoneDot
              milestone={milestone}
              active={activeDate === milestone.date}
              justCrossed={justCrossedDate === milestone.date}
              reduced={reduced}
            />
            {significant && (() => {
              const anchor = clampedLabelAnchor(x, plotWidth, estimateLabelWidth(milestone.description) / 2)
              return (
                <text
                  x={anchor.x - x}
                  y={-11}
                  textAnchor={anchor.textAnchor}
                  fill="var(--foreground)"
                  fontSize={10}
                  fontWeight={600}
                >
                  {masked ? milestone.description.replace(/₹[^\s)]+/g, MASK_TEXT) : milestone.description}
                </text>
              )
            })()}
          </g>
        )
      })}
    </g>
  )
}

/** Match a chart tooltip label to a milestone without coupling to Recharts. */
export function useMilestoneHover(
  milestones: Array<{ date: string; description: string }>,
  tooltipLabel: string | number | undefined
): string | null {
  return React.useMemo(() => {
    if (!tooltipLabel) return null
    const milestone = milestones.find((m) => m.description === String(tooltipLabel))
    return milestone?.date ?? null
  }, [milestones, tooltipLabel])
}
