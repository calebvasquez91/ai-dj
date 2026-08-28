import type { Track } from "@/types/music";
import type { TrackAnalysis } from "@/lib/audio-analysis";
import type { LyricalFingerprint } from "@/lib/lyrics";
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
export function shuffleForPlay(
  tracks: Track[],
  trackAnalysis: Record<string, TrackAnalysis> = {},
  lyricalFingerprints: Record<string, LyricalFingerprint> = {}
): Track[] {
  const eligible = tracks.filter((t) => t.playPreference !== "do-not");
  const must = eligible.filter((t) => t.playPreference === "must");
  const rest = eligible.filter((t) => t.playPreference !== "must");

  const toCandidates = (list: Track[]): SequencingCandidate[] =>
    list.map((track) => ({
      track,
      analysis: trackAnalysis[track.id] ?? null,
      lyricalFingerprint: lyricalFingerprints[track.id] ?? null,
    }));

  const orderedMust = buildCompatibleOrder(toCandidates(must));
  const lastMust = orderedMust[orderedMust.length - 1] ?? null;
  const orderedRest = buildCompatibleOrder(toCandidates(rest), lastMust);

  return [...orderedMust, ...orderedRest].map((c) => c.track);
}

function randomShuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * "Drop the Needle" — a simple, opt-in genuinely-random reorder. Distinct
 * from shuffleForPlay above: that one reasons about the whole library
 * (tempo/key/energy/lyrical-theme compatibility); this one is pure chance,
 * for when the user just wants a quick random mix rather than a
 * compatibility-scored set. Same curation-flag handling as shuffleForPlay
 * (Do-Not-Play excluded, Must-Play guaranteed and first) since those are
 * user intent regardless of *how* the remaining order gets picked — but no
 * scoring, no lookahead, just a fair shuffle. Whatever order this lands
 * on, the auto-DJ's transition engine still smooths over each pairing
 * exactly as it does for any other queue order — a random track order
 * never means an abrupt or unblended handoff.
 */
export function dropTheNeedle(tracks: Track[]): Track[] {
  const eligible = tracks.filter((t) => t.playPreference !== "do-not");
  const must = eligible.filter((t) => t.playPreference === "must");
  const rest = eligible.filter((t) => t.playPreference !== "must");
  return [...randomShuffle(must), ...randomShuffle(rest)];
}
