/**
 * The audio engineer's stem verdict: which tracks are worth the cost of separating into stems, and what the stems
 * would be good for. Pure scoring over what analysis already knows about a track — no audio, no network — so the
 * rules can be tested and the DJ and the stem autopilot (components/StemAutopilot.tsx) can share one opinion.
 *
 * Separation is a paid, multi-minute job per track (Replicate/Demucs), so the engineer is deliberately picky: a track
 * earns stems when there is something to do with them. A reliable tempo and bar grid mean a stem swap lands on the
 * beat; real dynamics and a drop give the swap somewhere to go; lyrics mean there is a vocal worth isolating.
 */

import type { TrackAnalysis } from "@/lib/audio-analysis";
import { energyProfileFromPeaks } from "@/lib/energyProfile";
import { isPhraseGridTrustworthy } from "@/lib/song-map";

/** Tracks shorter than this are skits and intros; longer than the cap are long mixes whose separation costs a lot. */
export const STEM_MIN_DURATION_SEC = 60;
export const STEM_MAX_DURATION_SEC = 10 * 60;
/** Minimum score for a track to be worth separating. */
export const STEM_WORTH_IT_SCORE = 55;

/** Tempo readings below this are guesses (same bar mix-engine.ts uses before trusting a tempo). */
const TRUSTED_TEMPO_CONFIDENCE = 0.35;
const STRONG_TEMPO_CONFIDENCE = 0.5;
const TRUSTED_KEY_CONFIDENCE = 0.4;

export type StemRole = "vocals" | "drums" | "bass" | "melody";

export interface StemCandidateInput {
  track: { id: string; source: string; durationSec: number };
  /** Undefined until the track has been analysed. */
  analysis: TrackAnalysis | undefined;
  /** The track's lyric fingerprint has words (a lyrics lookup found something) — a proxy for "has a vocal". */
  hasLyrics: boolean;
}

export interface StemVerdict {
  trackId: string;
  /** 0-100. */
  score: number;
  /** score >= STEM_WORTH_IT_SCORE and the track is eligible at all. */
  worthIt: boolean;
  /** Why, in plain words — shown in the UI and given to the DJ. */
  reasons: string[];
  /** Which stems this track's data suggests would be useful. */
  roles: StemRole[];
}

export function judgeStemCandidate({ track, analysis, hasLyrics }: StemCandidateInput): StemVerdict {
  const no = (reason: string): StemVerdict => ({ trackId: track.id, score: 0, worthIt: false, reasons: [reason], roles: [] });

  if (track.source !== "local") return no("only uploaded tracks have audio to separate");
  if (track.durationSec < STEM_MIN_DURATION_SEC) return no("too short");
  if (track.durationSec > STEM_MAX_DURATION_SEC) return no("too long (separating it would cost a lot)");
  if (!analysis || analysis.fallback) return no("not analysed yet");

  let score = 0;
  const reasons: string[] = [];
  const roles: StemRole[] = [];

  if (analysis.bpmConfidence >= STRONG_TEMPO_CONFIDENCE) {
    score += 25;
    reasons.push("clear tempo");
  } else if (analysis.bpmConfidence >= TRUSTED_TEMPO_CONFIDENCE) {
    score += 15;
    reasons.push("workable tempo");
  } else {
    reasons.push("unclear tempo");
  }

  const gridTrusted = isPhraseGridTrustworthy(analysis.songMap);
  if (gridTrusted) {
    score += 20;
    reasons.push("reliable bar grid");
    roles.push("drums");
  }

  // energyProfileFromPeaks is [] for a track too even to have a profile — nothing for a stem swap to build or release.
  const hasDynamics = energyProfileFromPeaks(analysis.waveformPeaks).length > 0;
  if (hasDynamics) {
    score += 20;
    reasons.push("real dynamics");
    roles.push("melody");
  }

  if (analysis.dropAtSec != null || analysis.buildDropPairs.length > 0) {
    score += 15;
    reasons.push("a clear drop");
  }

  if (hasLyrics) {
    score += 20;
    reasons.push("has vocals");
    roles.push("vocals");
  }

  if (analysis.keyConfidence >= TRUSTED_KEY_CONFIDENCE) roles.push("bass");

  return { trackId: track.id, score, worthIt: score >= STEM_WORTH_IT_SCORE, reasons, roles };
}

/** Verdicts for a list of tracks, in the order given (the queue's order: nearer tracks come first). */
export function judgeStemCandidates(inputs: StemCandidateInput[]): StemVerdict[] {
  return inputs.map(judgeStemCandidate);
}
