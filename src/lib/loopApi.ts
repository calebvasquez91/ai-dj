import {
  LOOP_PICK_TIMEOUT_MS,
  pickFallbackLoop,
  type AiLoopCandidate,
  type AiLoopTrackProfile,
} from "@/lib/ai-loop";

/**
 * Client-side caller for /api/dj/next-loop. Resolves to the chosen loop's id
 * (null only when there are no candidates). Never rejects and never waits
 * longer than the spec's 3 seconds: a slow, failed, or unusable response
 * falls back to a random loop that isn't the previous one, so the ambient
 * layer never stalls on the AI.
 */
export async function requestLoopPick(
  currentTrack: AiLoopTrackProfile,
  availableLoops: AiLoopCandidate[],
  previousLoopId: string | null
): Promise<string | null> {
  const fallback = () => pickFallbackLoop(availableLoops, previousLoopId).fxId;
  if (availableLoops.length === 0) return null;
  try {
    const res = await fetch("/api/dj/next-loop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentTrack, availableLoops, previousLoopId }),
      signal: AbortSignal.timeout(LOOP_PICK_TIMEOUT_MS),
    });
    if (!res.ok) return fallback();
    const data = (await res.json()) as { fxId?: unknown };
    const fxId = typeof data.fxId === "string" ? data.fxId : null;
    return fxId && availableLoops.some((l) => l.id === fxId) ? fxId : fallback();
  } catch {
    return fallback();
  }
}
