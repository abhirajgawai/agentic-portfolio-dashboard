/**
 * src/components/layout/PageHeader.tsx — Shared page title + subtitle used by
 * every workspace root (Journey, Allocation, Portfolio, Alerts, Properties,
 * Groww/Sharekhan Data). Plain sentence-case `<h1>` + muted subtitle, no
 * ALL-CAPS eyebrow label (Ledger Gold mockup pattern, see
 * docs/superpowers/specs/2026-09-12-ledger-gold-redesign-design.md).
 */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex w-full max-w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </div>
  )
}
