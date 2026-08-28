/**
 * Whole-library, compatibility-aware track ordering — replaces picking the
 * next track purely at random (see shuffle.ts) with a greedy nearest-
 * neighbor walk scored on tempo, key, energy, and (once configured, see
 * lib/lyrics.ts) lyrical/thematic similarity. Pure decision logic, no
 * audio — mirrors mix-engine.ts's own separation of scoring from playback.
 *
 * Genre is deliberately not a scoring input: there's no per-track genre
 * field anywhere in this app today (the "Style" picker in the UI is a
 * single session-wide hint used only for transition-technique scoring, not
 * a per-track tag), and inferring genre from raw audio is well beyond this
 * module's scope. Tempo, key, energy, and lyrical theme are the signals
 * that are actually available per track.
 */

import { bestTempoRatio, camelotCompatibility, MIN_KEY_CONFIDENCE_FOR_SCORING } from "@/lib/mix-engine";
import { lyricalSimilarity, type LyricalFingerprint } from "@/lib/lyrics";
import type { Track } from "@/types/music";
import type { TrackAnalysis } from "@/lib/audio-analysis";

export interface SequencingCandidate {
  track: Track;
  /** null when the track hasn't been analyzed yet — that candidate contributes 0 to every analysis-based score component rather than being excluded. */
  analysis: TrackAnalysis | null;
  /** null/omitted when no lyrical signal is available (today: always, until lib/lyrics.ts is wired to a real provider) — contributes 0, not a penalty. */
  lyricalFingerprint?: LyricalFingerprint | null;
}

/** Beyond this tempo gap (post-octave-adjustment), the tempo component of the score just bottoms out at 0 rather than going further negative — there's no "more incompatible than incompatible." */
const MAX_MEANINGFUL_BPM_DELTA = 0.3;

const WEIGHTS = { tempo: 0.35, key: 0.25, energy: 0.2, lyrical: 0.2 };

function meanEnergy(peaks: number[]): number {
  if (peaks.length === 0) return 0;
  return peaks.reduce((sum, v) => sum + v, 0) / peaks.length;
}

function tempoScore(a: TrackAnalysis, b: TrackAnalysis): number {
  if (a.bpm <= 0 || b.bpm <= 0) return 0;
  const delta = Math.abs(bestTempoRatio(a.bpm, b.bpm) - 1);
  return Math.max(0, 1 - delta / MAX_MEANINGFUL_BPM_DELTA);
}

function keyScore(a: TrackAnalysis, b: TrackAnalysis): number {
  if (a.keyConfidence < MIN_KEY_CONFIDENCE_FOR_SCORING || b.keyConfidence < MIN_KEY_CONFIDENCE_FOR_SCORING) return 0;
  return camelotCompatibility(a.camelotKey, b.camelotKey) / 2;
}

function energyScore(a: TrackAnalysis, b: TrackAnalysis): number {
  const ea = meanEnergy(a.waveformPeaks);
  const eb = meanEnergy(b.waveformPeaks);
  if (ea <= 0 || eb <= 0) return 0;
  return 1 - Math.min(1, Math.abs(ea - eb) / Math.max(ea, eb));
}

/** 0-1: how well `candidate` follows `current` — tempo/key closeness, similar energy (avoids a jarring energy whiplash), and lyrical/thematic overlap when both sides have a fingerprint. */
export function scoreCompatibility(current: SequencingCandidate, candidate: SequencingCandidate): number {
  if (!current.analysis || !candidate.analysis) return 0;
  const lyrical =
    current.lyricalFingerprint && candidate.lyricalFingerprint
      ? lyricalSimilarity(current.lyricalFingerprint, candidate.lyricalFingerprint)
      : 0;
  return (
    WEIGHTS.tempo * tempoScore(current.analysis, candidate.analysis) +
    WEIGHTS.key * keyScore(current.analysis, candidate.analysis) +
    WEIGHTS.energy * energyScore(current.analysis, candidate.analysis) +
    WEIGHTS.lyrical * lyrical
  );
}

/**
 * Greedy nearest-neighbor ordering: starting from `anchor` (or the first
 * candidate, if no anchor is given), repeatedly appends whichever remaining
 * candidate scores best against the *last* track placed so far. A simple
 * traveling-salesman-style heuristic, not a guaranteed-optimal tour, but
 * enough to replace "purely random" with "reasons about the whole pool"
 * without the combinatorial cost of an actual optimum.
 *
 * Ties (most commonly: no analysis data at all yet, so every score is 0)
 * are broken randomly rather than by array order — keeps some pleasant
 * variety when there's genuinely no signal to reason about, while any real
 * difference in compatibility always wins over that randomness.
 */
export function buildCompatibleOrder(
  candidates: SequencingCandidate[],
  anchor: SequencingCandidate | null = null
): SequencingCandidate[] {
  if (candidates.length === 0) return [];
  const remaining = [...candidates];
  const ordered: SequencingCandidate[] = [];
  let last = anchor;
  if (!last) {
    last = remaining.shift()!;
    ordered.push(last);
  }
  while (remaining.length > 0) {
    let bestScore = -Infinity;
    let bestIndices: number[] = [];
    for (let i = 0; i < remaining.length; i++) {
      const score = scoreCompatibility(last, remaining[i]);
      if (score > bestScore + 1e-9) {
        bestScore = score;
        bestIndices = [i];
      } else if (Math.abs(score - bestScore) <= 1e-9) {
        bestIndices.push(i);
      }
    }
    const pickIdx = bestIndices[Math.floor(Math.random() * bestIndices.length)];
    last = remaining.splice(pickIdx, 1)[0];
    ordered.push(last);
  }
  return ordered;
}
