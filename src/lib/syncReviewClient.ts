/**
 * Client side of the AI DJ's confirm-or-override step (lib/ai-sync.ts). Never throws and never waits long: the sync
 * is already running while this asks, so past SYNC_REVIEW_TIMEOUT_MS (or on any failure) the local review answers.
 */
import { reviewSyncPlanLocally, parseSyncReview, type SyncReview, type SyncReviewInput } from "@/lib/ai-sync";

export const SYNC_REVIEW_TIMEOUT_MS = 2500;

export async function requestSyncReview(input: SyncReviewInput): Promise<SyncReview> {
  try {
    const res = await fetch("/api/dj/sync-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(SYNC_REVIEW_TIMEOUT_MS),
    });
    if (!res.ok) return reviewSyncPlanLocally(input);
    const data = (await res.json()) as { usedFallback?: boolean } & Record<string, unknown>;
    const parsed = parseSyncReview(data);
    if (!parsed) return reviewSyncPlanLocally(input);
    return { ...parsed, usedFallback: data.usedFallback === true };
  } catch {
    return reviewSyncPlanLocally(input);
  }
}
