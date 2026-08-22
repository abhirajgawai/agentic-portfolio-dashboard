/**
 * Market hours helpers — pure functions, no side effects.
 *
 * Used by TodayPanel to decide whether to poll /api/live.
 * All times in IST (Asia/Kolkata) as per the pipeline's convention.
 *
 * Markets are Mon–Fri only (weekends excluded). Holidays are NOT checked
 * client-side (holiday data lives in the backend's calendars.py); the
 * frontend shows "Opens in X" on holidays — the backend gate handles the
 * real no-op. Weekends are the high-value fix here.
 */

/** Get IST components (day-of-week, minutes-from-midnight). */
function getIST(): { day: number; mins: number } {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return {
    day: ist.getDay(), // 0=Sun, 1=Mon, …, 6=Sat
    mins: ist.getHours() * 60 + ist.getMinutes(),
  }
}

/** True if the given IST day is a weekday (Mon–Fri). */
function isWeekday(day: number): boolean {
  return day >= 1 && day <= 5
}

/**
 * Days to add to reach the NEXT weekday from the given day.
 *   Mon–Thu → 1,  Fri → 3 (→ Mon),  Sat → 2 (→ Mon),  Sun → 1 (→ Mon)
 */
function daysToNextWeekday(day: number): number {
  if (day >= 1 && day <= 4) return 1
  if (day === 5) return 3
  if (day === 6) return 2
  return 1 // Sun
}

/** Milliseconds from `currentMins` to `targetMins` on day + daysToAdd. */
function msToTarget(
  currentMins: number,
  targetMins: number,
  daysToAdd: number,
): number {
  if (daysToAdd === 0) {
    return (targetMins - currentMins) * 60_000
  }
  return (
    ((1440 - currentMins) + daysToAdd * 1440 + targetMins) * 60_000
  )
}

/** True if today (IST) is a weekend — Sat or Sun. */
export function isWeekend(): boolean {
  return !isWeekday(getIST().day)
}

// ── IST market windows (minutes-from-midnight) ────────────────────────
const IN_OPEN = 555  // 09:15
const IN_CLOSE = 930 // 15:30
const US_OPEN = 1140 // 19:00
const US_CLOSE = 150 // 02:30 next day

export function isMarketHoursNow(): boolean {
  const { day, mins } = getIST()

  // Both markets are Mon–Fri only
  if (!isWeekday(day)) return false

  // IN market: 09:15–15:30 IST
  const inHours = mins >= IN_OPEN && mins <= IN_CLOSE

  // US market: 19:00–02:30 IST (next day, wraps midnight)
  const usHours = mins >= US_OPEN || mins <= US_CLOSE

  return inHours || usHours
}

/** Human-readable label for the currently-open market (if any). */
export function getActiveMarketLabel(): string | null {
  const { day, mins } = getIST()

  if (!isWeekday(day)) return null

  const inHours = mins >= IN_OPEN && mins <= IN_CLOSE
  const usHours = mins >= US_OPEN || mins <= US_CLOSE

  if (inHours && usHours) return 'IN + US'
  if (inHours) return 'IN'
  if (usHours) return 'US'
  return null
}

/**
 * Milliseconds until the next market session opens (or 0 if currently open).
 *
 * Accounts for weekends: on Sat/Sun the next open is Monday.
 * On a weekday after the last market closes, the next open is the next
 * weekday (could be later the same day if, e.g., it's 16:00 IST and
 * US opens at 19:00).
 */
export function msUntilNextMarketOpen(): number {
  if (isMarketHoursNow()) return 0

  const { day, mins } = getIST()

  // ── Next IN open ──────────────────────────────────────────────────
  let inDays: number
  if (isWeekday(day) && mins < IN_OPEN) {
    // Before IN open today → opens today
    inDays = 0
  } else {
    // After IN close on a weekday, or weekend → next weekday
    inDays = daysToNextWeekday(day)
  }

  // ── Next US open ──────────────────────────────────────────────────
  let usDays: number
  if (isWeekday(day) && mins < US_OPEN) {
    // Before US open today → opens today
    usDays = 0
  } else {
    // After US close on a weekday (02:30–09:15), or weekend → next weekday
    usDays = daysToNextWeekday(day)
  }

  const inMs = msToTarget(mins, IN_OPEN, inDays)
  const usMs = msToTarget(mins, US_OPEN, usDays)

  return Math.min(inMs, usMs)
}