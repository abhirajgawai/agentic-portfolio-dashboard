/** Four allocation donuts — geography, platform, sector, asset class.
 *  Every dimension sums to ~100% by construction (normalize/allocation.py). */

import { useMemo } from 'react'

import { EChart } from '@/components/charts/EChart'
import { donutOption, type NameValue } from '@/components/charts/options'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { platformLabel } from '@/lib/format'
import type { Allocation } from '@/types/contract'

function toNameValue(record: Record<string, number> | undefined): NameValue[] {
  return Object.entries(record ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }))
}

function DonutCard({ title, data }: { title: string; data: NameValue[] }) {
  const option = useMemo(
    () =>
      donutOption(data, {
        centerLabel: data.length > 0 ? `${data[0]?.value.toFixed(1)}%` : undefined,
        centerSub: data.length > 0 ? data[0]?.name : undefined,
      }),
    [data],
  )
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        {data.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
            No allocation data
          </div>
        ) : (
          <EChart option={option} height={200} />
        )}
      </CardContent>
    </Card>
  )
}

export function AllocationDonuts({ allocation }: { allocation: Allocation }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <DonutCard title="By geography" data={toNameValue(allocation.byGeography)} />
      <DonutCard
        title="By platform"
        data={toNameValue(allocation.byPlatform).map((d) => ({ ...d, name: platformLabel(d.name) }))}
      />
      <DonutCard title="By sector" data={toNameValue(allocation.bySector)} />
      <DonutCard
        title="By asset class"
        data={toNameValue(allocation.byAssetClass).map((d) => ({
          ...d,
          name: d.name.replaceAll('_', ' '),
        }))}
      />
    </div>
  )
}