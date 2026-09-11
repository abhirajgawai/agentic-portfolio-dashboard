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
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
