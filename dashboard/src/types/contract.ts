/**
 * M8 dashboard contract — Zod schemas for the five pipeline exports.
 *
 * THIS FILE IS THE CONTRACT. It mirrors the exact JSON shapes written by
 * scripts/export_json.py into `dashboard/public/data/`:
 *
 *   latest.json      the latest snapshot: totals, fx, allocation, holdings
 *   history.json     the derived per-date value series (portfolio.series, M-3)
 *   alerts.json      fired alert rules (M6)
 *   xirr.json        per-account XIRR (M5)
 *   performance.json daily performance tracker (M8.6)
 *   goals.json       savings goals from SQLite (M8.9)
 *
 * The same schemas are used in two places:
 *   1. at build/dev time by `npm run check:contract` (scripts/check-contract.ts)
 *      to machine-check the ACTUAL exported files;
 *   2. at runtime by src/lib/data.ts to parse fetched JSON into the inferred
 *      TS types below.
 *
 * M9 keeps this file untouched: Supabase/PostgREST views return the SAME
 * shapes, so swapping the data source is a base-URL change in data.ts.
 *
 * Import rules: this module is pure Zod + TS types (no browser globals), so it
 * can be loaded both by the Vite bundle and by the node check script.
 */

import { z } from 'zod'

/* ------------------------------------------------------------------ */
/* latest.json                                                         */
/* ------------------------------------------------------------------ */

export const HoldingSchema = z.object({
  platform: z.string(),
  geography: z.string(),
  ticker: z.string(),
  /** Zerodha live-leg rows have name=null (sector map fills them elsewhere). */
  name: z.string().nullable(),
  isin: z.string().nullable(),
  /** Settlement currency of the holding (INR for India, USD for moomoo). */
  currency: z.string(),
  qty: z.number(),
  avgPrice: z.number().nullable(),
  ltp: z.number(),
  /** Value in the holding's own currency. */
  value: z.number(),
  /** Value converted to the consolidated base (INR). */
  valueBase: z.number(),
  /** Value in the account's display currency (INR leg -> INR, moomoo -> SGD). */
  valueDisplay: z.number(),
  displayCurrency: z.string(),
  /** Per-holding freshness (position.updated_at). */
  asOf: z.string(),
  /** (value-cost)/cost in %, null when no cost basis (M3 CAS rows). */
  returnPct: z.number().nullable(),
  dayPnl: z.number().nullable(),
  dayChangePct: z.number().nullable(),
  pnl: z.number().nullable(),
  pnlPct: z.number().nullable(),
  canSellQty: z.number().nullable(),
  positionSide: z.string().nullable(),
  sector: z.string().nullable(),
  assetClass: z.string().nullable(),
})

export const PlatformStatusSchema = z.object({
  asOf: z.string().nullable(),
  /** True when the platform's last position update exceeds its staleness
   *  threshold (brokers 2d, CAS platforms 35d — export_json M-4). */
  stale: z.boolean(),
})

export const TotalsSchema = z.object({
  valueBase: z.number(),
  byAccountCurrency: z.record(z.string(), z.number()),
  dayPnl: z.number(),
  dayPnlByAccountCurrency: z.record(z.string(), z.number()),
})

export const AllocationSchema = z.object({
  byAccountCurrency: z.record(z.string(), z.number()),
  byGeography: z.record(z.string(), z.number()),
  byPlatform: z.record(z.string(), z.number()),
  bySector: z.record(z.string(), z.number()),
  byAssetClass: z.record(z.string(), z.number()),
})

export const LatestSchema = z.object({
  /** MAX(runs.started_at) over status='ok' runs — the last successful run.
   *  NULL on a fresh install before the first successful run. */
  asOf: z.string().nullable(),
  baseCurrency: z.string(),
  fx: z.object({
    USDINR: z.number(),
    SGDINR: z.number(),
    USD_SGD: z.number(),
  }),
  platforms: z.record(z.string(), PlatformStatusSchema),
  totals: TotalsSchema,
  allocation: AllocationSchema,
  holdings: z.array(HoldingSchema),
})

/* ------------------------------------------------------------------ */
/* history.json                                                        */
/* ------------------------------------------------------------------ */

export const HistorySchema = z.object({
  /** ISO dates ascending (one per snapshot day, mixed-frequency honest). */
  dates: z.array(z.string()),
  portfolioValueBase: z.array(z.number()),
  /** Array per geography, aligned by index with `dates`. */
  byGeography: z.record(z.string(), z.array(z.number())),
  /** Array per platform, aligned by index with `dates`. */
  byPlatform: z.record(z.string(), z.array(z.number())),
})

/* ------------------------------------------------------------------ */
/* alerts.json                                                         */
/* ------------------------------------------------------------------ */

export const AlertSeveritySchema = z.enum(['info', 'warn', 'critical'])

export const AlertSchema = z.object({
  ruleId: z.string(),
  severity: AlertSeveritySchema,
  message: z.string(),
})

export const AlertsSchema = z.object({
  generatedAt: z.string(),
  alerts: z.array(AlertSchema),
})

/* ------------------------------------------------------------------ */
/* xirr.json                                                           */
/* ------------------------------------------------------------------ */

export const XirrEntrySchema = z.object({
  currency: z.string(),
  /** Annualized rate in % — null when the account has no captured trades yet. */
  xirrPct: z.number().nullable(),
  terminalValue: z.number(),
  flowCount: z.number(),
})

export const XirrSchema = z.object({
  asOf: z.string(),
  perAccount: z.record(z.string(), XirrEntrySchema),
  estimated: z.boolean(),
})

/* ------------------------------------------------------------------ */
/* Property (UI import)                                                */
/* ------------------------------------------------------------------ */

export const PropertyImprovementSchema = z.object({
  date: z.string(),           // YYYY-MM-DD
  amount: z.number(),
  description: z.string().optional(),
})

export const PropertyImportRequestSchema = z.object({
  property_id: z.string(),
  address: z.string(),
  property_type: z.string().default("residential"),
  purchase_date: z.string(),  // YYYY-MM-DD
  purchase_price: z.number(),
  current_valuation: z.number(),
  valuation_date: z.string().optional(),  // YYYY-MM-DD, defaults to today
  improvements: z.array(PropertyImprovementSchema).default([]),
})

export const PropertyImportResponseSchema = z.object({
  ok: z.boolean(),
  import: z.string().optional(),
  export: z.string().optional(),
  error: z.string().optional(),
})

/* ------------------------------------------------------------------ */
/* performance.json (M8.6 daily performance tracker)                   */
/* ------------------------------------------------------------------ */

/** One top mover row for a single day (sorted by |dayPnlBase| desc by the
 *  pipeline; the UI re-sorts defensively). */
export const PerformanceMoverSchema = z.object({
  ticker: z.string(),
  name: z.string().nullable(),
  platform: z.string(),
  geography: z.string(),
  dayPnlBase: z.number(),
  valueBase: z.number(),
})

/** A revaluation/import event for one day. These are NOT day P&L — the value
 *  moved because the holding first appeared, a CAS import re-priced it, or a
 *  property valuation changed, not because the market moved. */
export const PerformanceRevalSchema = z.object({
  ticker: z.string(),
  name: z.string().nullable(),
  platform: z.string(),
  changeBase: z.number(),
  intervalDays: z.number().nullable(),
  kind: z.enum(['first_appearance', 'cas_import', 'property', 'other']),
})

export const PerformanceDailySchema = z.object({
  date: z.string(),
  valueBase: z.number(),
  dayPnlBase: z.number(),
  brokerDayPnl: z.record(z.string(), z.number()),
  dayPnlPct: z.number().nullable(),
  simpleReturnPct: z.number().nullable(),
  costCoverage: z.object({ withCost: z.number(), noCost: z.number() }),
  attribution: z.object({
    byGeography: z.record(z.string(), z.number()),
    byPlatform: z.record(z.string(), z.number()),
    byAssetClass: z.record(z.string(), z.number()),
  }),
  topMovers: z.array(PerformanceMoverSchema),
  revaluationEvents: z.array(PerformanceRevalSchema),
})

export const PerformanceSchema = z.object({
  asOf: z.string(),
  daily: z.array(PerformanceDailySchema),
  /** M5 XIRR payload embedded (no `estimated` flag — performance.json only
   *  exists for real, exported runs). */
  xirr: z.object({
    asOf: z.string(),
    perAccount: z.record(z.string(), XirrEntrySchema),
  }),
})

/* ------------------------------------------------------------------ */
/* goals.json (M8.9 — savings goals in the DB)                         */
/* ------------------------------------------------------------------ */

/** One savings goal. `id` is the STABLE SQLite id (the UI's crossing-ack key);
 *  `crossedAt` is stamped by the pipeline when valueBase first passed
 *  targetAmount (null until then). Progress itself is NEVER stored — the UI
 *  derives it from valueBase/targetAmount at render time. */
export const GoalSchema = z.object({
  id: z.number(),
  label: z.string(),
  targetAmount: z.number().positive(),
  color: z.string(),
  crossedAt: z.string().nullable(),
})

export const GoalsSchema = z.object({
  asOf: z.string(),
  /** Portfolio value (base currency) at export time — lets standalone
   *  consumers compute progress without latest.json. */
  valueBase: z.number(),
  goals: z.array(GoalSchema),
})

/* ------------------------------------------------------------------ */
/* Inferred types                                                      */
/* ------------------------------------------------------------------ */

export type Holding = z.infer<typeof HoldingSchema>
export type PlatformStatus = z.infer<typeof PlatformStatusSchema>
export type Totals = z.infer<typeof TotalsSchema>
export type Allocation = z.infer<typeof AllocationSchema>
export type Latest = z.infer<typeof LatestSchema>
export type History = z.infer<typeof HistorySchema>
export type Alert = z.infer<typeof AlertSchema>
export type Alerts = z.infer<typeof AlertsSchema>
export type Xirr = z.infer<typeof XirrSchema>
export type XirrEntry = z.infer<typeof XirrEntrySchema>
export type PropertyImportRequest = z.infer<typeof PropertyImportRequestSchema>
export type PropertyImportResponse = z.infer<typeof PropertyImportResponseSchema>
export type PropertyImprovement = z.infer<typeof PropertyImprovementSchema>
export type Performance = z.infer<typeof PerformanceSchema>
export type PerformanceDaily = z.infer<typeof PerformanceDailySchema>
export type PerformanceMover = z.infer<typeof PerformanceMoverSchema>
export type PerformanceReval = z.infer<typeof PerformanceRevalSchema>
export type Goal = z.infer<typeof GoalSchema>
export type Goals = z.infer<typeof GoalsSchema>
