---
name: project-orchestration
description: Coordinate multi-part Agentic Portfolio Dashboard work while preserving milestone gates, specialist ownership, and inspect-before-normalize ordering.
---

# Project orchestration

Use this for work with two or more independent deliverables. Read `PLAN.md` first and
treat its current milestone markers and `Done when` bars as authoritative. Confirm the
status from repository evidence because `README.md` and older skill summaries can lag.

State what is being built, why it belongs to the current milestone, and the concepts the
learner should understand. Split work by the ownership in `.codex/agents/`. Delegate
independent modules concurrently; keep same-file changes, milestone gates, and a broker's
inspect-before-normalize path sequential. Never parallelize across milestones.

Give each worker exact files, constraints, verification, and expected report. Tell it to
preserve concurrent edits. Review the combined diff and run the relevant checks yourself;
a worker report does not satisfy a milestone gate. Finish by explaining the result,
pointing to files worth studying, and naming the next unmet PLAN item.

Never delegate access to credentials or live portfolio data. Keep broker tools read-only,
Zerodha login manual, and M0-M6 plus M8 deterministic.
