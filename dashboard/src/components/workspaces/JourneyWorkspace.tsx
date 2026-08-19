/**
 * src/components/workspaces/JourneyWorkspace.tsx — Journey home (default view).
 *
 * The Journey home is SELF-CONTAINED and lives in
 * `src/components/journey/JourneyWorkspace.tsx`: it fetches latest/history/
 * alerts itself via the lib/data hooks and composes JourneyChart + TodayPanel +
 * AccountRoads + GoalMilestones + MilestoneJournal + YearStrip per
 * spec-round2 §4.1 (headline → journey chart → today/roads/goals+journal →
 * year strip). The determinism boundary is intact — it renders ONLY the
 * contract JSONs plus localStorage goals/journal; never the agent, never the
 * bridge.
 *
 * This file exists because the shell (`WorkspaceCenter`) imports the workspace
 * from `@/components/workspaces/JourneyWorkspace` while the shell worker lands
 * the no-prop signature. It is a thin compat wrapper: it tolerates the current
 * shell call site (extra `latest`/`masked`/`onDossierSelect` props are ignored
 * — the component reads everything itself) and renders the canonical
 * implementation. It can be deleted once the shell imports the journey one
 * directly.
 */

import { JourneyWorkspace as JourneyHome } from '@/components/journey/JourneyWorkspace'

interface JourneyWorkspaceProps {
  /** @deprecated — the workspace is self-contained; these props are ignored. */
  latest?: unknown
  masked?: boolean
  onDossierSelect?: (ticker: string) => void
}

export function JourneyWorkspace(_props?: JourneyWorkspaceProps) {
  return <JourneyHome />
}