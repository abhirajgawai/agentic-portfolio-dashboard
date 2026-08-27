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

import { useEffect, useState, type ReactNode } from "react";
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
import { cn } from "@/lib/utils";
import type { Latest } from "@/types/contract";

/* ------------------------------------------------------------------ */
/* Entrance stagger (motion-spec §1 — fade + 6px rise, 300ms, 60ms     */
/* apart; prefers-reduced-motion renders statically)                    */
/* ------------------------------------------------------------------ */

function Entrance({
  index = 0,
  className,
  children,
}: {
  index?: number;
  className?: string;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), 30);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div
      className={cn(
        "transition-all duration-300 ease-out motion-reduce:transition-none motion-reduce:translate-y-0 motion-reduce:opacity-100",
        shown ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0",
        className,
      )}
      style={{ transitionDelay: `${index * 60}ms` }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Headline                                                            */
/* ------------------------------------------------------------------ */

function Headline({ latest, masked }: { latest: Latest; masked: boolean }) {
  const animatedTotal = useAnimatedNumber(latest.totals.valueBase);

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs text-muted-foreground">Net worth</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
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
    <section className="space-y-4">
      <h1 className="sr-only">Journey</h1>

      <Entrance index={0}>
        <Headline latest={latest.data} masked={masked} />
      </Entrance>

      <Entrance index={0}>
        <StalenessBanner latest={latest.data} />
      </Entrance>

      <Entrance index={0}>
        <LiveJobsRow />
      </Entrance>

      <Entrance index={0}>
        <JourneyChart history={history.data} />
      </Entrance>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Entrance index={1}>
          <TodayPanel latest={latest.data} alerts={alerts.data} />
        </Entrance>
        <Entrance index={2}>
          <AccountRoads history={history.data} />
        </Entrance>
        <Entrance index={3}>
          <div className="space-y-4">
            <GoalMilestones valueBase={latest.data.totals.valueBase} />
            <MilestoneJournal history={history.data} />
          </div>
        </Entrance>
      </div>

      <Entrance index={4}>
        <YearStrip history={history.data} />
      </Entrance>
    </section>
  );
}
