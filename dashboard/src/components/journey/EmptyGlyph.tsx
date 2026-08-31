export function EmptyGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 40" className={className} aria-hidden="true">
      <path d="M4 34 Q 20 30 28 20 T 48 8" fill="none" stroke="var(--muted-foreground)"
            strokeWidth="1.5" strokeDasharray="3 3" strokeLinecap="round" opacity="0.6" />
      <circle cx="50" cy="8" r="5" fill="none" stroke="var(--chart-1)" strokeWidth="1.5" opacity="0.7" />
    </svg>
  )
}
