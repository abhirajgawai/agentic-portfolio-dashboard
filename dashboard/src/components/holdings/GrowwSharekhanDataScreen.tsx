/**
 * Groww/Sharekhan Data — merged tab (was two separate tabs: CAS Import +
 * Manual Equities). Both dealt with the same underlying problem — getting
 * Groww/Sharekhan holdings into the system when neither broker exposes an
 * API/MCP — so they now live as two stacked sections under one nav entry
 * instead of two:
 *
 *   1. CAS Import (unchanged) — automated Groww MF import (CAMS+KFintech) +
 *      manual full-statement upload for the monthly demat CAS.
 *   2. Manual Equities (unchanged) — hand-entered total value per platform
 *      for Groww/Sharekhan equities (no per-share breakdown available).
 *
 * Both sections are the EXISTING components, reused as-is — this file is
 * pure composition, no logic duplicated or rewritten.
 */

import { CasImportScreen } from '@/components/cas/CasImportScreen'
import { ManualEquitiesScreen } from '@/components/holdings/ManualEquitiesScreen'
import { PageHeader } from '@/components/layout/PageHeader'

export function GrowwSharekhanDataScreen() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Groww / Sharekhan Data"
        subtitle="Everything for keeping Groww and Sharekhan holdings current — automated mutual fund import below, manual equity values further down."
      />

      <CasImportScreen />

      <ManualEquitiesScreen />
    </div>
  )
}
