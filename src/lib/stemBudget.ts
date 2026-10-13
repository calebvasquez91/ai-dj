/**
 * The spending guard for automatic stem separation. Each separation is a paid GPU job, so automatic starts are held
 * to a budget and a small number of jobs at once. Pure, and shared by the server route (which enforces it — a client
 * can't be trusted with the money) and the UI (which shows it).
 *
 * The recorded cost of a job (StemSeparationJob.estimatedCostUsd) only exists once it finishes, so jobs still in
 * flight are counted at a deliberately generous assumed cost, which keeps a burst of starts from overshooting.
 */

export const DEFAULT_AUTO_BUDGET_USD = 5;
/** Counted against the budget for every job that has not finished (and for the one about to start). */
export const ASSUMED_JOB_COST_USD = 0.1;
/** Automatic separations running at the same time, per user. */
export const MAX_AUTO_IN_FLIGHT = 2;

export interface AutoBudgetInput {
  /** Sum of recorded estimatedCostUsd over the user's finished jobs. */
  spentUsd: number;
  /** Jobs pending or processing right now. */
  inFlight: number;
  budgetUsd: number;
  maxInFlight?: number;
}

export type AutoBudgetDecision =
  | { allowed: true; remainingUsd: number }
  | { allowed: false; reason: "budget" | "busy"; remainingUsd: number };

export function autoBudgetDecision({ spentUsd, inFlight, budgetUsd, maxInFlight = MAX_AUTO_IN_FLIGHT }: AutoBudgetInput): AutoBudgetDecision {
  const committed = spentUsd + inFlight * ASSUMED_JOB_COST_USD;
  const remainingUsd = Math.max(0, budgetUsd - committed);
  if (inFlight >= maxInFlight) return { allowed: false, reason: "busy", remainingUsd };
  // the job about to start is counted at the assumed cost too
  if (committed + ASSUMED_JOB_COST_USD > budgetUsd) return { allowed: false, reason: "budget", remainingUsd };
  return { allowed: true, remainingUsd };
}

/** The configured budget (an env var string), or the default when it is missing or not a sensible number. */
export function parseAutoBudgetUsd(raw: string | undefined | null): number {
  if (raw == null || raw.trim() === "") return DEFAULT_AUTO_BUDGET_USD;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1000 ? value : DEFAULT_AUTO_BUDGET_USD;
}
