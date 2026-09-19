import type { Track } from "@/types/music";
import type { TrackAnalysis } from "@/lib/audio-analysis";
import type { LyricalFingerprint } from "@/lib/lyrics";
import { pickWeightedNext, type SequencingCandidate } from "@/lib/track-sequencing";

/** How many tracks Shuffle Play queues up when it starts. */
export const SHUFFLE_INITIAL_COUNT = 10;
/** How many tracks the DJ adds each time the queue runs low, mid-session. */
export const SHUFFLE_EXTEND_COUNT = 5;
/** Extend as soon as this many tracks (or fewer) remain queued behind the current one. */
export const SHUFFLE_EXTEND_THRESHOLD = 5;

/** Do-Not-Play tracks are excluded entirely — the only filter a shuffle session's pool applies. Never blocks a direct manual play; only affects automatic shuffle selection. */
export function buildShuffleSessionPool(tracks: Track[]): Track[] {
  return tracks.filter((t) => t.playPreference !== "do-not");
}

function toCandidate(
  track: Track,
  trackAnalysis: Record<string, TrackAnalysis>,
  lyricalFingerprints: Record<string, LyricalFingerprint>
): SequencingCandidate {
  return {
    track,
    analysis: trackAnalysis[track.id] ?? null,
    lyricalFingerprint: lyricalFingerprints[track.id] ?? null,
  };
}

/**
 * The opening batch for a new shuffle session: Must-Play tracks are
 * guaranteed inclusion, chained first via the same weighted-random,
 * compatibility-aware pick as everything else (never forced into every
 * later extension — see extendShuffleQueue). Filled out to
 * SHUFFLE_INITIAL_COUNT (or the whole pool, if smaller). `recentOpeningIds`
 * — the previous session's opening batch — only deprioritizes the very
 * first pick, nudging a fresh session away from restarting on the exact
 * same track without hard-excluding it.
 */
export function buildInitialShuffleBatch(
  pool: Track[],
  trackAnalysis: Record<string, TrackAnalysis>,
  lyricalFingerprints: Record<string, LyricalFingerprint>,
  recentOpeningIds: string[] = []
): Track[] {
  const must = pool.filter((t) => t.playPreference === "must");
  const rest = pool.filter((t) => t.playPreference !== "must");
  const targetCount = Math.max(must.length, SHUFFLE_INITIAL_COUNT);

  const remaining = [...must, ...rest].map((t) => toCandidate(t, trackAnalysis, lyricalFingerprints));
  const picked: SequencingCandidate[] = [];
  let last: SequencingCandidate | null = null;
  const deprioritize = new Set(recentOpeningIds);

  while (remaining.length > 0 && picked.length < targetCount) {
    // Must-Play tracks are picked first, in the same weighted-random order,
    // by restricting the candidate pool to them until they're exhausted.
    const stillMustOnly = picked.length < must.length;
    const candidatePool = stillMustOnly ? remaining.filter((c) => c.track.playPreference === "must") : remaining;
    const next = pickWeightedNext(last, candidatePool, 5, picked.length === 0 ? deprioritize : undefined);
    picked.push(next);
    remaining.splice(remaining.indexOf(next), 1);
    last = next;
  }
  return picked.map((c) => c.track);
}

/**
 * Picks SHUFFLE_EXTEND_COUNT more tracks for a running shuffle session,
 * anchored on the last track already queued so the compatibility chain
 * stays continuous across the extension seam. Draws from `unplayedIds`
 * first; if that runs out mid-batch (a small library "lapping"), refills
 * it from the full pool minus whatever's still live in the queue
 * (`protectIds`) and keeps going, so the same still-queued track is never
 * picked twice in a row.
 */
export function extendShuffleQueue(
  session: { pool: Track[]; unplayedIds: string[] },
  anchor: Track,
  protectIds: Set<string>,
  trackAnalysis: Record<string, TrackAnalysis>,
  lyricalFingerprints: Record<string, LyricalFingerprint>
): { batch: Track[]; unplayedIds: string[] } {
  const byId = new Map(session.pool.map((t) => [t.id, t]));
  let unplayedIds = [...session.unplayedIds];
  const batch: Track[] = [];
  let last: SequencingCandidate = toCandidate(anchor, trackAnalysis, lyricalFingerprints);

  while (batch.length < SHUFFLE_EXTEND_COUNT) {
    if (unplayedIds.length === 0) {
      const relapped = session.pool.filter((t) => !protectIds.has(t.id));
      if (relapped.length === 0) break; // the whole live pool has shrunk to nothing — nothing left to add
      unplayedIds = relapped.map((t) => t.id);
    }
    const remaining = unplayedIds.map((id) => toCandidate(byId.get(id)!, trackAnalysis, lyricalFingerprints));
    const next = pickWeightedNext(last, remaining, 5);
    batch.push(next.track);
    unplayedIds = unplayedIds.filter((id) => id !== next.track.id);
    last = next;
  }
  return { batch, unplayedIds };
}
