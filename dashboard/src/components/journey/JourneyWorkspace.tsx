/**
 * Journey workspace — the default home of the Journey OS shell. Layout per
 * spec-round2 §4.1: hero headline (total value + day P&L) → JourneyChart
 * (range pills + dataZoom) → a row of TodayPanel / AccountRoads /
 * GoalMilestones+MilestoneJournal → YearStrip.
 *
 * Determinism boundary: renders ONLY the contract JSONs (latest/history/
 * alerts via lib/data hooks) plus localStorage goals/journal — never the
 * agent, never the bridge. The headline + day P&L tick with delta counters
 * (motion-spec §2); side cards stagger in 60ms apart (motion-spec §1) via a
 * transition-based entrance that prefers-reduced-motion disables.
 *
 * Export signature for the shell worker:
 *   <JourneyWorkspace />  (no props — self-contained)
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
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs text-muted-foreground">Net worth</p>
        <p className="font-headline mt-1 text-4xl tabular-nums sm:text-5xl">
          {masked ? MASK_TEXT : formatInrCompact(animatedTotal)}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          as of {formatAsOf(latest.asOf)} · {latest.holdings.length} holdings
        </p>
      </div>
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

export function JourneyWorkspace() {
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

      <motion.div variants={item}>
        <Headline latest={latest.data} masked={masked} />
      </motion.div>

      <motion.div variants={item}>
        <StalenessBanner latest={latest.data} />
      </motion.div>

      <motion.div variants={item}>
        <LiveJobsRow />
      </motion.div>

      <motion.div variants={item}>
        <JourneyChart history={history.data} />
      </motion.div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <motion.div variants={item}>
          <TodayPanel latest={latest.data} alerts={alerts.data} />
        </motion.div>
        <motion.div variants={item}>
          <AccountRoads history={history.data} />
        </motion.div>
        <motion.div variants={item}>
          <div className="space-y-4">
            <GoalMilestones valueBase={latest.data.totals.valueBase} />
            <MilestoneJournal history={history.data} />
          </div>
        </motion.div>
      </div>

      <motion.div variants={item}>
        <YearStrip history={history.data} />
      </motion.div>
    </motion.section>
  );
}
