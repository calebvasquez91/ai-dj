// Stutter repeats (behind STUTTER_ENABLED): a slice of the playing song, one note long (1/4, 1/8 or 1/16), repeats a few times, starting on a beat
// and ending on the beat after, then the song carries on. It is done on the live signal with the deck's own delay line: the delay time is set to the
// slice, the signal is sent into it for exactly one slice, the dry signal is muted and the feedback holds the slice going round, then everything
// is put back, all as parameter automation on the audio clock, so it is locked to the master clock and the beat grid whatever the playhead does.
// The DJ plays one only at an energy peak or a drop, and no more often than once every 16 bars (the frequency setting stretches that, and a genre
// that is not hip-hop, rap or electronic stretches it further); how hard it hits follows the occasion. Never random. Pure.
import type { TrackAnalysis } from "@/lib/audio-analysis";
import type { DjSetMode } from "@/lib/mix-engine";
import { barsToSec, barsUntil, beatLengthSec, energyAt, gapElapsed, genreMoveWeight, modeIntensity, nextBoundary } from "@/lib/djMoves";
import type { ParamLike } from "@/lib/djEq";

/** The shortest gap between two stutters, in bars. */
export const STUTTER_MIN_GAP_BARS = 16;
/** The longest, at the lowest frequency setting for a genre it favours. */
export const STUTTER_MAX_GAP_BARS = 64;
/** The song must be at least this energetic (0-1) for a stutter that is not on a drop. */
export const STUTTER_PEAK_ENERGY = 0.8;
export const STUTTER_BPM_RANGE = { min: 70, max: 180 } as const;
/** A stutter lasts this many beats in all, whatever the note. */
export const STUTTER_BEATS = 2;
/** No stutter starts in the last stretch of a song: the mix out of it (the transition engine fades this deck) may begin any moment, and a stutter must not be caught by it. */
export const STUTTER_END_GUARD_SEC = 30;
/** A deck whose fade level is below this is being mixed (in or out), so it is left alone. */
export const STUTTER_MIN_DECK_LEVEL = 0.95;

export type StutterNote = "1/4" | "1/8" | "1/16";
/** How many beats one slice of each note lasts. The one place the notes are listed: STUTTER_NOTES, the Settings choices and their labels all follow it. */
const NOTE_BEATS: Record<StutterNote, number> = { "1/4": 1, "1/8": 0.5, "1/16": 0.25 };
/** The notes a person can pick, longest slice first (the keys of NOTE_BEATS, in the order written). */
export const STUTTER_NOTES = Object.keys(NOTE_BEATS) as StutterNote[];
/** The longest slice a stutter may repeat, seconds: the deck's stutter delay line holds one second (createDelay(1) in DualDeckStage), and a longer delay time is clamped. */
export const STUTTER_MAX_SLICE_SEC = 0.95;

/** `note`, or the next shorter one when a slice of it would not fit the delay line at this beat length (a quarter note on a song under about 63 BPM). */
export function fitNoteToDelayLine(note: StutterNote, beatSec: number): StutterNote {
  for (let i = STUTTER_NOTES.indexOf(note); i < STUTTER_NOTES.length; i++) {
    if (NOTE_BEATS[STUTTER_NOTES[i]] * beatSec <= STUTTER_MAX_SLICE_SEC) return STUTTER_NOTES[i];
  }
  return STUTTER_NOTES[STUTTER_NOTES.length - 1];
}

export interface StutterMove {
  startSec: number;
  note: StutterNote;
  /** One slice, seconds: also the delay time. */
  sliceSec: number;
  /** How many times the slice is heard in all. */
  repeats: number;
  durationSec: number;
  where: "drop" | "peak";
  reason: string;
}

export interface StutterContext {
  analysis: TrackAnalysis;
  durationSec: number;
  currentTimeSec: number;
  lastMoveAtSec: number | null;
  genre?: string | null;
  mode?: DjSetMode | null;
  /** 0 (rarely) to 1 (as often as the rules allow). */
  frequency: number;
  /** The note the person picked in Settings. Null or absent: the occasion and genre choose it (noteForIntensity). */
  note?: StutterNote | null;
}

/** The note for an intensity: a harder occasion and genre choose the finer slice. */
export function noteForIntensity(intensity: number): StutterNote {
  return intensity >= 0.8 ? "1/16" : intensity >= 0.5 ? "1/8" : "1/4";
}

/** The note a Settings value asks for: the fixed note, or null for "auto" (the occasion and genre choose). */
export function stutterNoteFor(setting: string | null | undefined): StutterNote | null {
  return (STUTTER_NOTES as readonly string[]).includes(setting ?? "") ? (setting as StutterNote) : null;
}

/** The gap between stutters in bars: 16 at full frequency for a favoured genre, up to 64 at none, and longer again for a genre that is not favoured. */
export function stutterGapBars(frequency: number, genre: string | null | undefined): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(frequency) ? frequency : 0.5));
  const base = STUTTER_MIN_GAP_BARS + (1 - f) * (STUTTER_MAX_GAP_BARS - STUTTER_MIN_GAP_BARS);
  return Math.round(base / genreMoveWeight(genre));
}

/** The next stutter for the playing song, or null when none is supported now. */
export function planStutter(ctx: StutterContext): StutterMove | null {
  const { analysis, durationSec, currentTimeSec: now } = ctx;
  const bpm = analysis.bpm;
  if (analysis.fallback || !(bpm >= STUTTER_BPM_RANGE.min && bpm <= STUTTER_BPM_RANGE.max)) return null;
  if (!gapElapsed(ctx.lastMoveAtSec, now, barsToSec(stutterGapBars(ctx.frequency, ctx.genre), bpm))) return null;
  const energy = energyAt(analysis, now, durationSec);
  if (energy == null) return null;
  if (durationSec - now < STUTTER_END_GUARD_SEC) return null;

  const beat = beatLengthSec(bpm);
  const intensity = modeIntensity(ctx.mode) * genreMoveWeight(ctx.genre);
  const note = fitNoteToDelayLine(ctx.note ?? noteForIntensity(intensity), beat);
  const slice = NOTE_BEATS[note] * beat;
  const repeats = Math.round((STUTTER_BEATS * beat) / slice);
  const build = (startSec: number, where: StutterMove["where"], tail: string): StutterMove => ({
    startSec,
    note,
    sliceSec: slice,
    repeats,
    durationSec: STUTTER_BEATS * beat,
    where,
    reason: `energy ${energy.toFixed(2)}, ${Math.round(bpm)} BPM, ${tail}`,
  });

  // On a drop: on the bar line of a drop that is about to land (or has just landed, within a beat).
  const drops = [...analysis.buildDropPairs.map((p) => p.dropAtSec), ...(analysis.dropAtSec != null ? [analysis.dropAtSec] : [])];
  for (const drop of drops.sort((a, b) => a - b)) {
    if (drop >= now && drop <= now + barsToSec(1, bpm)) {
      const start = nextBoundary(analysis, drop - 1e-3, "bar");
      if (start != null && start >= now) return build(start, "drop", `${note} on the drop in ${barsUntil(start, now, bpm)} bars`);
    }
  }
  // In a peak: on the next beat.
  if (energy >= STUTTER_PEAK_ENERGY) {
    const start = nextBoundary(analysis, now, "beat");
    if (start != null) return build(start, "peak", `${note} in a peak`);
  }
  return null;
}

/** The stutter of the button on the DJ board: on the next beat, whatever the energy or the gap (a person pressed it), with the note the person picked, else the one the occasion calls for. */
export function manualStutter(ctx: Pick<StutterContext, "analysis" | "currentTimeSec" | "genre" | "mode" | "note"> & { durationSec?: number }): StutterMove | null {
  const { analysis, currentTimeSec: now } = ctx;
  if (analysis.fallback || !(analysis.bpm > 0)) return null;
  if (ctx.durationSec != null && ctx.durationSec - now < STUTTER_END_GUARD_SEC) return null;
  const start = nextBoundary(analysis, now, "beat");
  if (start == null) return null;
  const beat = beatLengthSec(analysis.bpm);
  const note = fitNoteToDelayLine(ctx.note ?? noteForIntensity(modeIntensity(ctx.mode) * genreMoveWeight(ctx.genre)), beat);
  const slice = NOTE_BEATS[note] * beat;
  return { startSec: start, note, sliceSec: slice, repeats: Math.round((STUTTER_BEATS * beat) / slice), durationSec: STUTTER_BEATS * beat, where: "peak", reason: `manual ${note} stutter on the next beat` };
}

/** The deck's echo parameters a stutter borrows, and what to put back afterwards. */
export interface StutterTarget {
  delaySendGain: ParamLike;
  delayTime: ParamLike;
  feedbackGain: ParamLike;
  dryGain: ParamLike;
}
export interface StutterRestore {
  delayTime: number;
  feedback: number;
  send: number;
  dry: number;
}

const EDGE_SEC = 0.004;

/**
 * Writes the stutter on the audio clock. At the start the delay time becomes the slice and the signal is sent into the delay for exactly one slice;
 * after that slice the dry signal is muted and the feedback keeps the slice going round; at the end everything goes back (the dry first, then the
 * echo, so nothing is heard twice). Never starts before `nowCtxTime`.
 */
export function scheduleStutter(target: StutterTarget, move: StutterMove, startCtxTime: number, nowCtxTime: number, restore: StutterRestore): void {
  const t0 = Math.max(startCtxTime, nowCtxTime);
  const captured = t0 + move.sliceSec;
  const end = t0 + move.durationSec;
  target.delayTime.cancelScheduledValues(t0);
  target.delayTime.setValueAtTime(move.sliceSec, t0);
  target.delaySendGain.cancelScheduledValues(t0);
  target.delaySendGain.setValueAtTime(1, t0);
  target.delaySendGain.setValueAtTime(1, captured - EDGE_SEC);
  target.delaySendGain.linearRampToValueAtTime(0, captured);
  target.feedbackGain.cancelScheduledValues(t0);
  target.feedbackGain.setValueAtTime(0.96, t0);
  target.dryGain.cancelScheduledValues(captured);
  target.dryGain.setValueAtTime(restore.dry, captured - EDGE_SEC);
  target.dryGain.linearRampToValueAtTime(0, captured);
  // the end: dry back first, then the echo's feedback stops and the delay line is put as it was
  target.dryGain.setValueAtTime(0, end - EDGE_SEC);
  target.dryGain.linearRampToValueAtTime(restore.dry, end);
  target.feedbackGain.setValueAtTime(0.96, end - EDGE_SEC);
  target.feedbackGain.linearRampToValueAtTime(restore.feedback, end + 0.02);
  target.delaySendGain.setValueAtTime(0, end);
  target.delaySendGain.setValueAtTime(restore.send, end + 0.02);
  target.delayTime.setValueAtTime(restore.delayTime, end + 0.05);
}
