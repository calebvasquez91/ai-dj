/**
 * Server-side: how much stem separation a user has run and spent, and the budget automatic separation is held to.
 * Used by the stems route (to enforce the budget on automatic starts) and the summary route (for the UI).
 */

import { parseAutoBudgetUsd } from "@/lib/stemBudget";

/** A job still "pending"/"processing" this long after it was created is treated as abandoned, not as running. */
const IN_FLIGHT_MAX_AGE_MS = 30 * 60 * 1000;

/** The slice of a Prisma client this needs (a real client or a transaction client). */
export interface StemJobDb {
  stemSeparationJob: {
    findMany(args: {
      where: { track: { userId: string } };
      select: { status: true; estimatedCostUsd: true; createdAt: true };
    }): Promise<{ status: string; estimatedCostUsd: number | null; createdAt: Date }[]>;
  };
}

export interface StemSummary {
  /** Sum of the recorded (estimated) cost of the user's finished jobs. */
  spentUsd: number;
  /** Jobs pending or processing and recent enough to be genuinely running. */
  inFlight: number;
  ready: number;
  failed: number;
  budgetUsd: number;
}

export async function stemSummaryForUser(db: StemJobDb, userId: string, now = Date.now()): Promise<StemSummary> {
  const jobs = await db.stemSeparationJob.findMany({
    where: { track: { userId } },
    select: { status: true, estimatedCostUsd: true, createdAt: true },
  });
  let spentUsd = 0;
  let inFlight = 0;
  let ready = 0;
  let failed = 0;
  for (const job of jobs) {
    spentUsd += job.estimatedCostUsd ?? 0;
    if (job.status === "ready") ready++;
    else if (job.status === "failed") failed++;
    else if (now - job.createdAt.getTime() <= IN_FLIGHT_MAX_AGE_MS) inFlight++;
  }
  return { spentUsd, inFlight, ready, failed, budgetUsd: parseAutoBudgetUsd(process.env.STEM_AUTO_BUDGET_USD) };
}
