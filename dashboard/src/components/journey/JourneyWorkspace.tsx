/**
 * Journey workspace — "how am I doing, right now and over time" (design brief
 * docs/superpowers/specs/2026-09-12-ledger-gold-redesign-design.md §3.1).
 * Ledger Gold layout: hero (net-worth headline in `.font-headline` Fraunces +
 * live-sync pill chips) → compact staleness chip (deep-links to Alerts,
 * replacing the old full-detail warning box) → a two-column grid
 * (`1fr 340px`-ish, stacks on narrow viewports): chart + year strip on the
 * left, a condensed account snapshot + today's change + goals/journal rail
 * on the right.
 *
 * Determinism boundary: renders ONLY the contract JSONs (latest/history/
 * alerts via lib/data hooks) plus localStorage goals/journal — never the
 * agent, never the bridge. The headline + day P&L tick with delta counters
 * (motion-spec §2); side cards stagger in 60ms apart (motion-spec §1) via a
 * transition-based entrance that prefers-reduced-motion disables.
 *
 * Export signature for the shell worker:
 *   <JourneyWorkspace onWorkspaceChange={setWorkspace} />
 *   (onWorkspaceChange is optional — the staleness chip renders as
 *   non-interactive if the caller doesn't pass it.)
 */

import { motion, type Variants } from "motion/react";
import { AccountRoads } from "@/components/journey/AccountRoads";
import { GoalMilestones } from "@/components/journey/GoalMilestones";
import { JourneyChart } from "@/components/journey/JourneyChart";
import { LiveJobsRow } from "@/components/journey/LiveJobsRow";
import { MilestoneJournal } from "@/components/journey/MilestoneJournal";
import { StalenessBanner } from "@/components/journey/StalenessBanner";
import { TodayPanel } from "@/components/journey/TodayPanel";
import { YearStrip } from "@/components/journey/YearStrip";
import { useAnimatedNumber } from "@/components/journey/animation";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/layout/states";
import { useAlerts, useHistory, useLatest } from "@/lib/data";
import { formatAsOf, formatInrCompact, MASK_TEXT } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import type { WorkspaceId } from "@/lib/workspaces";
import type { Latest } from "@/types/contract";
import { usePrefersReducedMotion } from "./motion";

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 26 },
  },
};

/* ------------------------------------------------------------------ */
/* Headline                                                            */
/* ------------------------------------------------------------------ */

function Headline({ latest, masked }: { latest: Latest; masked: boolean }) {
  const animatedTotal = useAnimatedNumber(latest.totals.valueBase);

  return (
    <div>
      <p className="text-xs text-muted-foreground">Net worth</p>
      <p className="font-headline mt-1 text-4xl tabular-nums text-foreground sm:text-5xl">
        {masked ? MASK_TEXT : formatInrCompact(animatedTotal)}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        as of {formatAsOf(latest.asOf)} · {latest.holdings.length} holdings
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Loading skeleton (spec §4.4 — one hero block + three cards)         */
/* ------------------------------------------------------------------ */

function HeroSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading journey…">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-48" />
      </div>
      <Card className="p-4">
        <Skeleton className="h-80 w-full" />
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-44 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

export function JourneyWorkspace({
  onWorkspaceChange,
}: {
  /** Switches the active top-level workspace — wired to the staleness chip
   *  so it can deep-link to Alerts (design brief §3.1/§3.4). Optional so the
   *  component still renders standalone (e.g. in isolation/tests). */
  onWorkspaceChange?: (ws: WorkspaceId) => void;
} = {}) {
  const latest = useLatest();
  const history = useHistory();
  const alerts = useAlerts();
  const { masked } = usePrivacy();
  const reduced = usePrefersReducedMotion();

  if (latest.isLoading || history.isLoading || alerts.isLoading) {
    return <HeroSkeleton />;
  }

  if (latest.isError || history.isError || alerts.isError) {
    const firstError = latest.error ?? history.error ?? alerts.error;
    return (
      <ErrorState
        message={
          firstError instanceof Error ? firstError.message : String(firstError)
        }
        onRetry={() => {
          void latest.refetch();
          void history.refetch();
          void alerts.refetch();
        }}
      />
    );
  }

  if (!latest.data || !history.data) return null;

  return (
    <motion.section
      className="space-y-4"
      variants={container}
      initial={reduced ? "show" : "hidden"}
      animate="show"
    >
      <h1 className="sr-only">Journey</h1>

      {/* Hero: net-worth headline + live-sync pill chips + staleness chip */}
      <motion.div variants={item} className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Headline latest={latest.data} masked={masked} />
          <LiveJobsRow />
        </div>
        <StalenessBanner
          latest={latest.data}
          onNavigateToAlerts={onWorkspaceChange ? () => onWorkspaceChange("alerts") : undefined}
        />
      </motion.div>

      {/* Chart (left, wide) + rail (right, ~340px) — two INDEPENDENTLY
       *  flowing columns (flex, not a shared grid row), each sized to its
       *  own content. A shared-row grid here previously forced the shorter
       *  left column to stretch to the taller right rail's height, leaving
       *  ~944px of dead ivory below the chart (QA finding I1). Goals +
       *  Milestone Journal now live in the left column, under the chart —
       *  the right rail (today's move + condensed account snapshot) is the
       *  denser column, so front-loading the left column with more content
       *  is what actually closes the gap, not a layout trick. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <motion.div variants={item} className="min-w-0 flex-1 space-y-4">
          <JourneyChart history={history.data} />
          <YearStrip history={history.data} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <GoalMilestones valueBase={latest.data.totals.valueBase} />
            <MilestoneJournal history={history.data} />
          </div>
        </motion.div>
        <motion.div variants={item} className="space-y-4 lg:w-[340px] lg:shrink-0">
          <TodayPanel latest={latest.data} alerts={alerts.data} />
          <AccountRoads history={history.data} variant="condensed" />
        </motion.div>
      </div>
    </motion.section>
  );
}
