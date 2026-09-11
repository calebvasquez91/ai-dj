// Gets a usable bpm into mix-engine.ts's existing tempo-fit/beat-grid math
// for YouTube tracks — which never get real per-sample analysis (no raw
// audio access through the official IFrame Player API, see
// YouTubeDeckStage.tsx) — without a second scoring system. Both paths just
// populate the exact same trackAnalysis map local tracks already use, with
// every field besides bpm/bpmConfidence left at fallbackAnalysis()'s neutral
// values, since we have no real beat-grid/key/energy data for either source.
import { useStore } from "@/lib/store";
import { fallbackAnalysis, type TrackAnalysis } from "@/lib/audio-analysis";

/** Assigned to a user-tapped tempo — real, user-verified data, same tier as a genuine local-file analysis result (well above mix-engine.ts's MIN_TEMPO_CONFIDENCE_FOR_TRUST). */
export const TAP_BPM_CONFIDENCE = 0.9;

function neutralAnalysisWithBpm(bpm: number, bpmConfidence: number): TrackAnalysis {
  return { ...fallbackAnalysis(), bpm, bpmConfidence, fallback: false };
}

/**
 * Best-effort metadata BPM lookup for a YouTube track (via a server-side
 * Deezer proxy — see lib/deezerBpm.ts for why this can't be a direct
 * client-side call). Silently does nothing on no match or any failure —
 * the track just keeps scoring as neutral, exactly like today, never a
 * broken state.
 */
export async function lookupYoutubeBpm(trackId: string): Promise<void> {
  try {
    const res = await fetch(`/api/tracks/${trackId}/bpm-lookup`, { method: "POST" });
    if (!res.ok) return;
    const data = (await res.json()) as { bpm: number | null; bpmConfidence: number | null };
    if (typeof data.bpm !== "number" || typeof data.bpmConfidence !== "number") return;
    // Already persisted server-side by the lookup route — just sync local state.
    useStore.getState().setYoutubeBpm(trackId, neutralAnalysisWithBpm(data.bpm, data.bpmConfidence), "metadata", false);
  } catch {
    // Network error — leave the track exactly as it is today.
  }
}

/** Commits a user-tapped tempo for a YouTube track — overrides any existing metadata guess, since this is higher-confidence, user-verified data. */
export function submitYoutubeTapTempo(trackId: string, bpm: number): void {
  useStore.getState().setYoutubeBpm(trackId, neutralAnalysisWithBpm(bpm, TAP_BPM_CONFIDENCE), "tap", true);
}
