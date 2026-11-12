/**
 * Client side of the AI DJ's FX plan (lib/ai-fx-plan.ts): builds the engineer's candidates for a song, asks the DJ which
 * to play, and returns the plan. Never throws and never waits long: the plan is made while the song is already
 * playing, so past FX_PLAN_TIMEOUT_MS (or on any failure) the engineer's own pick answers instead.
 */
import { fxPlanLocally, parseFxPlanReview, type FxPlanReview } from "@/lib/ai-fx-plan";
import { buildFxPlan, planFromReview, type BuildFxPlanArgs, type PlannedFx } from "@/lib/fxScheduler";

export const FX_PLAN_TIMEOUT_MS = 9000;

export interface FxPlanResult {
  planned: PlannedFx[];
  summary: string;
  usedFallback: boolean;
}

export async function requestFxPlan(args: BuildFxPlanArgs): Promise<FxPlanResult> {
  const built = buildFxPlan(args);
  if (!built) return { planned: [], summary: "", usedFallback: true };

  let review: FxPlanReview = fxPlanLocally(built.input);
  try {
    const res = await fetch("/api/dj/fx-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(built.input),
      signal: AbortSignal.timeout(FX_PLAN_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = (await res.json()) as { usedFallback?: boolean } & Record<string, unknown>;
      const parsed = parseFxPlanReview(data);
      if (parsed) review = { ...parsed, usedFallback: data.usedFallback === true };
    }
  } catch {
    // keep the engineer's own pick
  }
  return { planned: planFromReview(built, review), summary: review.summary, usedFallback: review.usedFallback };
}
