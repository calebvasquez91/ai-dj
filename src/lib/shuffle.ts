import type { Track } from "@/types/music";
import type { TrackAnalysis } from "@/lib/audio-analysis";
import { buildCompatibleOrder, type SequencingCandidate } from "@/lib/track-sequencing";

/**
 * Shuffle order for Shuffle Play: Do-Not-Play tracks are excluded entirely,
 * Must-Play tracks are guaranteed inclusion at the front. Within each of
 * those two groups, tracks are ordered by whole-library compatibility
 * (tempo/key/energy/lyrical-theme, see track-sequencing.ts) via a greedy
 * nearest-neighbor walk rather than picked at random — random only survives
 * as track-sequencing's own tiebreak for candidates that score identically
 * (most commonly: analysis hasn't finished yet for one or both sides).
 * `trackAnalysis` is a lookup by track id; a track missing from it (not yet
 * analyzed) still gets included, just with a neutral 0 score everywhere.
 * This only governs *automatic* selection — a direct manual click on a
 * Do-Not-Play track still plays it, since curation flags should never
 * block an explicit request.
 */
export function shuffleForPlay(tracks: Track[], trackAnalysis: Record<string, TrackAnalysis> = {}): Track[] {
  const eligible = tracks.filter((t) => t.playPreference !== "do-not");
  const must = eligible.filter((t) => t.playPreference === "must");
  const rest = eligible.filter((t) => t.playPreference !== "must");

  const toCandidates = (list: Track[]): SequencingCandidate[] =>
    list.map((track) => ({ track, analysis: trackAnalysis[track.id] ?? null }));

  const orderedMust = buildCompatibleOrder(toCandidates(must));
  const lastMust = orderedMust[orderedMust.length - 1] ?? null;
  const orderedRest = buildCompatibleOrder(toCandidates(rest), lastMust);

  return [...orderedMust, ...orderedRest].map((c) => c.track);
}
