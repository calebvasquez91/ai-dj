/**
 * Matched-mashup decision logic: given a confidently-analyzed, harmonically
 * compatible, tempo-close track pair, plans an extended (16-32 bar) overlap
 * where the incoming track plays tempo/key-matched over the outgoing one —
 * a distinct "special moment" the auto-DJ can opportunistically reach for,
 * not just another quick-transition entry. Pure decision logic, no audio —
 * mirrors mix-engine.ts's own separation of scoring from execution; the
 * actual playback (decoding, the SoundTouchJS voice, the gain/tempo/pitch
 * choreography, and the handoff back to a normal <audio> deck) lives in
 * DualDeckStage.tsx.
 */

import {
  bestTempoRatio,
  camelotCompatibility,
  snapToBeatGrid,
  MIN_KEY_CONFIDENCE_FOR_SCORING,
  MIN_TEMPO_CONFIDENCE_FOR_TRUST,
} from "@/lib/mix-engine";
import type { TrackAnalysis } from "@/lib/audio-analysis";
import type { Track } from "@/types/music";

/**
 * How far apart two tracks' tempos can be (after best-octave adjustment)
 * and still be a listenable time-stretch. Wider than a normal tempo-sync
 * window since SoundTouchJS genuinely corrects the gap instead of just
 * tolerating it — but WSOLA artifacts get more noticeable well past this,
 * so this isn't "however far SoundTouch can technically go."
 */
export const MASHUP_MAX_TEMPO_DELTA = 0.2;

export const MASHUP_MIN_BARS = 16;
export const MASHUP_MAX_BARS = 32;

/** Minimum real time between mashups so it stays an occasional highlight, not the default transition style. */
export const MASHUP_COOLDOWN_SEC = 240;

export interface MashupPlan {
  /** Incoming track's playback-speed multiplier (its own native tempo * this = the outgoing track's tempo). */
  tempoRatio: number;
  /** Incoming track's pitch shift in semitones, independent of tempo. 0 when the pair is already harmonically compatible without shifting. */
  pitchSemitones: number;
  /** Where in the incoming track's own timeline to start. */
  entryOffsetSec: number;
  barsCount: number;
  /** Computed from barsCount at the outgoing track's tempo. */
  durationSec: number;
  camelotScore: number;
  rationale: string;
}

interface TrackInput {
  track: Track;
  analysis: TrackAnalysis;
}

function hasConfidentAnalysis(analysis: TrackAnalysis): boolean {
  return (
    analysis.bpmConfidence >= MIN_TEMPO_CONFIDENCE_FOR_TRUST &&
    analysis.keyConfidence >= MIN_KEY_CONFIDENCE_FOR_SCORING
  );
}

/** True when both tracks are confidently analyzed, harmonically compatible, and close enough in tempo for a clean time-stretch. */
export function isMashupEligible(current: TrackInput, next: TrackInput): boolean {
  if (!hasConfidentAnalysis(current.analysis) || !hasConfidentAnalysis(next.analysis)) return false;
  const camelotScore = camelotCompatibility(current.analysis.camelotKey, next.analysis.camelotKey);
  if (camelotScore < 1) return false;
  const tempoDelta = Math.abs(bestTempoRatio(current.analysis.bpm, next.analysis.bpm) - 1);
  return tempoDelta <= MASHUP_MAX_TEMPO_DELTA;
}

function parseCamelot(code: string): { number: number; letter: string } | null {
  const m = code.match(/^(\d{1,2})([AB])$/);
  if (!m) return null;
  return { number: parseInt(m[1], 10), letter: m[2] };
}

/**
 * Semitone shift to bring `next`'s key exactly onto `current`'s — only
 * when it's a mode-safe move: adjacent Camelot number, same letter (a
 * perfect-fifth relationship, so both stay in the same major/minor mode).
 * Identical keys and relative-major/minor pairs (same number, different
 * letter) are already harmonically compatible without shifting — pitch-
 * shifting those wouldn't make them "more" compatible, just different, so
 * they get 0.
 */
function camelotSemitoneShift(currentCode: string | null, nextCode: string | null): number {
  const a = currentCode ? parseCamelot(currentCode) : null;
  const b = nextCode ? parseCamelot(nextCode) : null;
  if (!a || !b || a.letter !== b.letter || a.number === b.number) return 0;
  const stepsUp = ((a.number - b.number) % 12 + 12) % 12; // how many +1 (perfect-fifth) steps from next to current
  if (stepsUp !== 1 && stepsUp !== 11) return 0; // not adjacent on the wheel
  const semitones = stepsUp === 1 ? 7 : -7;
  // Fold to the smaller-magnitude equivalent (+7 semitones is the same pitch class as -5).
  return semitones > 6 ? semitones - 12 : semitones < -6 ? semitones + 12 : semitones;
}

/** Plans a mashup for an eligible pair, or returns null if the pair doesn't qualify — safe to call without checking isMashupEligible() first. */
export function planMashup(current: TrackInput, next: TrackInput): MashupPlan | null {
  if (!isMashupEligible(current, next)) return null;

  const tempoRatio = bestTempoRatio(current.analysis.bpm, next.analysis.bpm);
  const pitchSemitones = camelotSemitoneShift(current.analysis.camelotKey, next.analysis.camelotKey);
  const camelotScore = camelotCompatibility(current.analysis.camelotKey, next.analysis.camelotKey);

  const barsCount = MASHUP_MIN_BARS + Math.round(Math.random() * (MASHUP_MAX_BARS - MASHUP_MIN_BARS));
  const effectiveBpm = current.analysis.bpm > 0 ? current.analysis.bpm : 120;
  const durationSec = (barsCount * 4 * 60) / effectiveBpm; // 4 beats per bar

  const entryOffsetSec = snapToBeatGrid(
    next.analysis.energyOnsetSec,
    next.analysis.beatGridOffsetSec,
    next.analysis.bpm
  );

  const harmonicNote = camelotScore >= 2 ? "same key" : "compatible keys";
  const pitchNote =
    pitchSemitones !== 0
      ? `, pitch-shifted ${pitchSemitones > 0 ? "+" : ""}${pitchSemitones} semitones to match`
      : "";
  const rationale = `Mashup — layering "${next.track.title}" in tempo/key-matched over "${current.track.title}" for ${barsCount} bars (${harmonicNote}${pitchNote}).`;

  return { tempoRatio, pitchSemitones, entryOffsetSec, barsCount, durationSec, camelotScore, rationale };
}
