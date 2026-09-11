/**
 * Pure derivation for the milestone journal — deterministic: same history
 * always produces the same narration (the determinism boundary). No React,
 * no storage; MilestoneJournal owns persistence, JourneyChart owns the pins.
 *
 * Honesty guards (the M-3 mixed-frequency lesson applied to narration):
 *  - a move spanning > 7 ledger days is labeled "across N days" (a re-price
 *    gap is never mislabeled a one-day crash);
 *  - a move onto a day with FEWER platforms non-zero than the previous point
 *    is labeled "partial snapshot" (some legs did not run that day);
 *  - crossings are generic ₹10L boundaries — "Crossed ₹1Cr" appears only
 *    when the ledger actually crosses it (deterministic, never invented).
 *  - ATH fires only on genuine new peaks; recovery fires once per drawdown cycle.
 */

import { formatInrCompact } from '@/lib/format'
import type { History } from '@/types/contract'

export type JournalEntry = {
  id: string
  /** ISO date (YYYY-MM-DD) — the ledger day the event is visible on. */
  date: string
  description: string
}

/** Milestone = a journal entry with chart coordinates (markPoint data). */
export type Milestone = JournalEntry & {
  /** Index into history.dates. */
  index: number
  /** portfolioValueBase at that index. */
  value: number
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/** "2026-08-18" -> "18 Aug 2026" (string math only — no timezone math). */
export function formatShortDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day} ${MONTHS[Number(month) - 1] ?? month} ${year}`
}

/** Crossing boundaries — ₹10L steps up to ₹1Cr, then major milestones beyond. */
const CROSS_LEVELS = [
  30_00_000, 40_00_000, 50_00_000, 60_00_000, 70_00_000,
  80_00_000, 90_00_000, 1_00_00_000,
  2_00_00_000, 3_00_00_000, 5_00_00_000, 7_00_00_000,
  10_00_00_000, 15_00_00_000, 25_00_00_000, 50_00_00_000,
] as const

function dayDiff(a: string, b: string): number {
  const ta = new Date(`${a}T00:00:00Z`).getTime()
  const tb = new Date(`${b}T00:00:00Z`).getTime()
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0
  return Math.round((tb - ta) / 86_400_000)
}

function platformCountAt(history: History, index: number): number {
  let count = 0
  for (const series of Object.values(history.byPlatform)) {
    if ((series[index] ?? 0) > 0) count += 1
  }
  return count
}

/**
 * Milestones for the chart: threshold crossings + all-time highs + drawdown recoveries.
 * (One per event — the chart dedupes by index for pin spacing.)
 */
export function deriveMilestones(history: History): Milestone[] {
  const out: Milestone[] = []
  const dates = history.dates
  const values = history.portfolioValueBase

  // --- 1. Threshold crossings (extended beyond ₹1Cr) ---
  const crossedLevels = new Set<number>()
  for (let i = 1; i < dates.length; i += 1) {
    const lo = Math.min(values[i - 1] ?? 0, values[i] ?? 0)
    const hi = Math.max(values[i - 1] ?? 0, values[i] ?? 0)
    const crossed = CROSS_LEVELS.filter((level) => level > lo && level <= hi)
    if (crossed.length === 0) continue
    // One per day, highest level crossed (same rule as before)
    const level = crossed[crossed.length - 1] ?? 0
    if (crossedLevels.has(level)) continue // only first crossing fires
    crossedLevels.add(level)
    out.push({
      id: `cross:${dates[i]}:${level}`,
      date: dates[i] ?? '—',
      index: i,
      value: values[i] ?? 0,
      description: `Crossed ${formatInrCompact(level)}`,
    })
  }

  // --- 2. All-Time High (ATH) milestones ---
  let runningMax = -Infinity
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] ?? 0
    if (v > runningMax) {
      runningMax = v
      if (i > 0) { // skip day 0 (no prior peak to exceed)
        out.push({
          id: `ath:${dates[i]}`,
          date: dates[i] ?? '—',
          index: i,
          value: v,
          description: `New all-time high: ${formatInrCompact(v)}`,
        })
      }
    }
  }

  // --- 3. Drawdown Recovery milestones ---
  // Track peak-to-trough drawdowns; fire once when recovery reaches within 1% of peak.
  let peakValue = values[0] ?? 0
  let peakIndex = 0
  let inDrawdown = false
  let troughValue = peakValue
  let troughIndex = peakIndex
  const recoveredDrawdowns = new Set<string>()

  for (let i = 1; i < values.length; i += 1) {
    const v = values[i] ?? 0

    if (!inDrawdown) {
      // Look for a new peak
      if (v > peakValue) {
        peakValue = v
        peakIndex = i
      } else {
        // Check if we've entered a drawdown > 10%
        const ddPct = ((peakValue - v) / peakValue) * 100
        if (ddPct > 10) {
          inDrawdown = true
          troughValue = v
          troughIndex = i
        }
      }
    } else {
      // In a drawdown — track the trough
      if (v < troughValue) {
        troughValue = v
        troughIndex = i
      }

      // Check for recovery to within 1% of the peak
      const recoveryPct = ((v - peakValue) / peakValue) * 100
      if (recoveryPct >= -1) {
        const ddKey = `${peakIndex}-${troughIndex}`
        if (!recoveredDrawdowns.has(ddKey)) {
          const drawdownPct = ((peakValue - troughValue) / peakValue) * 100
          out.push({
            id: `recovery:${dates[i]}`,
            date: dates[i] ?? '—',
            index: i,
            value: v,
            description: `Recovered from ${drawdownPct.toFixed(1)}% drawdown`,
          })
          recoveredDrawdowns.add(ddKey)
        }
        // Reset for next potential drawdown
        inDrawdown = false
        peakValue = v
        peakIndex = i
        troughValue = v
        troughIndex = i
      }
    }
  }

  // Sort by date then id for deterministic output
  out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  return out
}

/**
 * Journal entries = milestones + the largest single-day moves, with honest
 * mixed-frequency labels on every move.
 */
export function deriveJournalEntries(history: History): JournalEntry[] {
  const out: JournalEntry[] = deriveMilestones(history).map(({ id, date, description }) => ({
    id,
    date,
    description,
  }))

  const jumps: Array<{ date: string; delta: number; gapDays: number; partial: boolean }> = []
  for (let i = 1; i < history.dates.length; i += 1) {
    const prev = history.portfolioValueBase[i - 1] ?? 0
    const curr = history.portfolioValueBase[i] ?? 0
    const delta = curr - prev
    if (delta === 0) continue
    jumps.push({
      date: history.dates[i] ?? '—',
      delta,
      gapDays: dayDiff(history.dates[i - 1] ?? '', history.dates[i] ?? ''),
      partial: platformCountAt(history, i) < platformCountAt(history, i - 1),
    })
  }
  jumps.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  for (const jump of jumps.slice(0, 3)) {
    const notes: string[] = []
    if (jump.gapDays > 7) notes.push(`across ${jump.gapDays} days`)
    if (jump.partial) notes.push('partial snapshot')
    const suffix = notes.length > 0 ? ` (${notes.join(', ')})` : ''
    out.push({
      id: `jump:${jump.date}`,
      date: jump.date,
      description: `Biggest ${jump.delta > 0 ? 'gain' : 'drop'}: ${
        jump.delta > 0 ? '+' : '−'
      }${formatInrCompact(Math.abs(jump.delta))}${suffix}`,
    })
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  return out
}