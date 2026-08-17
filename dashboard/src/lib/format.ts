/**
 * Formatting helpers — display-only, no logic that affects data integrity.
 * Currency formatting uses Intl with the currency's native grouping.
 */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const inrPrecise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
})

const sgd = new Intl.NumberFormat('en-SG', {
  style: 'currency',
  currency: 'SGD',
  maximumFractionDigits: 0,
})

/** Compact INR: ₹66.79L / ₹1.23Cr — the header-card convention. */
export function formatInrCompact(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`
}

/** Full INR with Indian digit grouping (₹66,79,289). */
export function formatInr(value: number): string {
  return inr.format(value)
}

export function formatInrPrecise(value: number): string {
  return inrPrecise.format(value)
}

/** SGD display value for the US leg (en-SG grouping). */
export function formatSgd(value: number): string {
  return sgd.format(value)
}

/** Currency-aware: pick by code, fall back to a generic 2-dp number. */
export function formatMoney(value: number, currency: string): string {
  switch (currency) {
    case 'INR':
      return formatInrPrecise(value)
    case 'SGD':
      return formatSgd(value)
    default:
      return `${currency} ${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  }
}

/** Signed percentage with one fixed decimal: "+42.0%", "-6.96%". */
export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

/** Unsigned percentage for allocation donuts: "31.6%". */
export function formatAllocPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value.toFixed(1)}%`
}

/** Quantity: trim trailing zeros (5662.814, 199, 12.5062). */
export function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10000) / 10000)
}

/** Price with up to 2 decimals. */
export function formatPrice(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 })
}

/**
 * Human "as of" label from an ISO timestamp: "14 Aug, 18:30 IST".
 * Unparseable input renders as "—" (freshness must never crash the UI).
 */
export function formatAsOf(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })
}

/** Long form for headers: "14 Aug 2026, 6:30 pm". */
export function formatAsOfLong(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })
}

/** Platform label for badges (lowercase keys -> Title Case). */
export function platformLabel(platform: string): string {
  return platform.charAt(0).toUpperCase() + platform.slice(1)
}