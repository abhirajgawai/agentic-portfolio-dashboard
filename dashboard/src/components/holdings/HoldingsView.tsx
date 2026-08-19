/** Combined holdings view — all holdings across India + US in one tab.
 *  Geography filter (All / India / US) at the top, then platform filter
 *  narrows to the relevant brokers for the selected geography. */

import { useMemo, useState } from 'react'

import { HoldingsTable } from '@/components/holdings/HoldingsTable'
import { Badge } from '@/components/ui/badge'
import { ErrorState, LoadingState } from '@/components/layout/states'
import { formatInrCompact, formatSgd, MASK_TEXT, platformLabel, assetClassLabel } from '@/lib/format'
import { useLatest } from '@/lib/data'
import { usePrivacy } from '@/lib/privacy'
import { cn } from '@/lib/utils'

type GeoFilter = 'all' | 'IN' | 'US'

const GEO_OPTIONS: { value: GeoFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'IN', label: 'India' },
  { value: 'US', label: 'US' },
]

const PLATFORMS_BY_GEO: Record<GeoFilter, readonly string[]> = {
  all: ['all'],
  IN: ['all', 'zerodha', 'groww', 'sharekhan'],
  US: ['all', 'moomoo'],
}

const ASSET_CLASSES = ['all', 'etf', 'mutual_fund', 'stock'] as const
type AssetClassFilter = (typeof ASSET_CLASSES)[number] | string

export function HoldingsView() {
  const latest = useLatest()
  const { masked } = usePrivacy()
  const [geo, setGeo] = useState<GeoFilter>('all')
  const [platform, setPlatform] = useState('all')
  const [assetClass, setAssetClass] = useState<AssetClassFilter>('all')

  const allHoldings = useMemo(() => latest.data?.holdings ?? [], [latest.data])

  // Filter by geography
  const geoHoldings = useMemo(() => {
    if (geo === 'all') return allHoldings
    return allHoldings.filter((h) => h.geography === geo)
  }, [allHoldings, geo])

  // Filter by platform
  const platformFiltered = useMemo(() => {
    if (platform === 'all') return geoHoldings
    return geoHoldings.filter((h) => h.platform === platform)
  }, [geoHoldings, platform])

  // Filter by asset class
  const filtered = useMemo(() => {
    if (assetClass === 'all') return platformFiltered
    return platformFiltered.filter((h) => h.assetClass === assetClass)
  }, [platformFiltered, assetClass])

  // Dynamic asset classes for the current geography + platform combo
  const availableAssetClasses = useMemo(() => {
    const base = platform === 'all' ? geoHoldings : platformFiltered
    const classes = new Set(base.map((h) => h.assetClass).filter((c): c is string => c !== null))
    return ['all', ...Array.from(classes).sort()]
  }, [geoHoldings, platformFiltered, platform])

  // Dynamic platforms for the current geography
  const availablePlatforms = useMemo(
    () => PLATFORMS_BY_GEO[geo],
    [geo],
  )

  if (latest.isLoading) return <LoadingState label="Loading holdings…" />
  if (latest.isError) {
    return (
      <ErrorState
        message={latest.error instanceof Error ? latest.error.message : String(latest.error)}
        onRetry={() => void latest.refetch()}
      />
    )
  }

  const totalInr = filtered
    .filter((h) => h.displayCurrency === 'INR')
    .reduce((sum, h) => sum + h.valueBase, 0)
  const totalSgd = filtered
    .filter((h) => h.displayCurrency === 'SGD')
    .reduce((sum, h) => sum + h.valueDisplay, 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Geography filter */}
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
          {GEO_OPTIONS.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => {
                setGeo(g.value)
                setPlatform('all')
                setAssetClass('all')
              }}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                geo === g.value
                  ? 'bg-background text-foreground shadow'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* Platform filter — only when a specific geo is selected */}
        {geo !== 'all' && availablePlatforms.length > 1 && (
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {availablePlatforms.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPlatform(p)
                  setAssetClass('all')
                }}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  platform === p
                    ? 'bg-background text-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p === 'all' ? 'All' : platformLabel(p)}
              </button>
            ))}
          </div>
        )}

        {/* Asset class filter */}
        {availableAssetClasses.length > 1 && (
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {availableAssetClasses.map((ac) => (
              <button
                key={ac}
                type="button"
                onClick={() => setAssetClass(ac)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  assetClass === ac
                    ? 'bg-background text-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {ac === 'all' ? 'All' : assetClassLabel(ac)}
              </button>
            ))}
          </div>
        )}

        <Badge variant="outline" className="ml-auto font-normal tabular-nums">
          {filtered.length} holding{filtered.length === 1 ? '' : 's'} ·{' '}
          {masked
            ? MASK_TEXT
            : totalInr > 0
              ? formatInrCompact(totalInr)
              : totalSgd > 0
                ? formatSgd(totalSgd)
                : '—'}
        </Badge>
      </div>

      <HoldingsTable
        holdings={filtered}
        displayCurrency={geo === 'US' ? 'SGD' : 'INR'}
        platformVisible={geo !== 'US'}
      />
    </div>
  )
}
