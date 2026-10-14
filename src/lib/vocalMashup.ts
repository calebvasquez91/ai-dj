/**
 * The vocal mashup: once the playing track's singing is over (lib/voiceMap.ts says so), the NEXT track's isolated
 * vocal is laid over it, tempo- and key-matched, for about half a minute; then the rest of the next track comes in
 * while the outgoing one fades, and the tempo and pitch ease back to the next track's own before it carries on by
 * itself. Pure planning and curves — no audio; DualDeckStage runs it with the same SoundTouch voices the mashup
 * engine uses (lib/time-stretch.ts).
 *
 * Why only the NEXT track needs stems: the outgoing track has no voice left, so its normal mix already is the
 * instrumental. The incoming track's instrumental is its full mix minus its separated vocal
 * (instrumentalFromMixAndVocal), which needs just the one vocal stem Replicate returns.
 */
import { MAX_ACTIVE_PLAY_SEC, bestTempoRatio } from "@/lib/mix-engine";
import { camelotSemitoneShift, isMashupEligible, type MashupPlan } from "@/lib/mashup-engine";
import { isPhraseGridTrustworthy } from "@/lib/song-map";
import type { TrackAnalysis } from "@/lib/audio-analysis";
import type { Track } from "@/types/music";

/** How long the vocal rides alone over the outgoing instrumental. Rounded to whole bars at the outgoing tempo. */
export const VOCAL_MASHUP_HOLD_SEC = 30;
/** The gradual hand-off: the incoming instrumental comes in, the outgoing track goes out, tempo and pitch ease home. */
export const VOCAL_MASHUP_HANDOFF_BARS = 8;
/** Below this the mashup isn't worth starting; the normal transition takes the exit instead. */
export const VOCAL_MASHUP_MIN_HOLD_BARS = 8;
/** The vocal fades in over this many bars. */
export const VOCAL_MASHUP_INTRO_BARS = 2;
/** Never plan to run right up to the last sample of the outgoing file. */
const END_MARGIN_SEC = 1;
/** Smallest lead before the first bar line, so the start isn't scheduled in the past by the time it runs. */
const MIN_LEAD_SEC = 0.25;
/** Level of the outgoing deck and the vocal during the hold, leaving headroom for their sum. */
export const VOCAL_MASHUP_HOLD_LEVEL = 0.9;

interface TrackInput {
  track: Track;
  analysis: TrackAnalysis;
}

export interface VocalMashupPlan {
  /** Incoming track's playback-speed multiplier: its native tempo x this = the outgoing track's tempo. */
  tempoRatio: number;
  /** Incoming pitch shift in semitones, independent of tempo; 0 for same/relative keys. */
  pitchSemitones: number;
  /** Seconds from now until the outgoing track's next bar line (or beat), where the vocal comes in. */
  startDelaySec: number;
  /** Where in the incoming track's own timeline the vocal starts: a bar line at or just before its first voice. */
  entryOffsetSec: number;
  introSec: number;
  holdSec: number;
  handoffSec: number;
  /** holdSec + handoffSec: the whole mashup, from the vocal's entry until the incoming track carries on alone. */
  totalSec: number;
  holdBars: number;
  camelotScore: number;
  rationale: string;
}

export interface VocalMashupInput {
  current: TrackInput;
  next: TrackInput;
  /** Where the outgoing track is now. */
  currentTimeSec: number;
  currentDurationSec: number;
  /** When the outgoing track's voices are done (voiceCutoffSec), or null when there is no usable voice map. */
  voiceCutoffSec: number | null;
  /** The incoming track's first voiced moment, read from its vocal stem; the entry falls back to its energy onset. */
  nextFirstVoiceSec: number | null;
}

/**
 * The engine leaves every track by MAX_ACTIVE_PLAY_SEC minus its window, so a mashup triggered by "the voices are
 * over" can only happen when that is comfortably before the cap. Used to avoid separating a track for a mashup the
 * cap would pre-empt. `voiceCutoffSec` is lib/voiceMap.ts's voiceCutoffSec for the outgoing track.
 */
export const VOCAL_MASHUP_CAP_MARGIN_SEC = 20;
export function vocalMashupBeatsTheCap(voiceCutoffSec: number | null): boolean {
  return voiceCutoffSec != null && voiceCutoffSec < MAX_ACTIVE_PLAY_SEC - VOCAL_MASHUP_CAP_MARGIN_SEC;
}

/** Whether this pair could ever be mashed up: confidently analysed, compatible keys, close enough in tempo to stretch. */
export function isVocalMashupPair(current: TrackInput, next: TrackInput): boolean {
  return isMashupEligible(current, next);
}

function beatSec(bpm: number): number {
  return 60 / (bpm > 0 ? bpm : 120);
}

/** The first bar line (trustworthy song map) or, failing that, beat of the track strictly after `afterSec`. */
export function nextGridPointAfter(analysis: TrackAnalysis, afterSec: number): number {
  const map = analysis.songMap;
  if (isPhraseGridTrustworthy(map)) {
    const bar = map.downbeats.find((t) => t > afterSec);
    if (bar != null) return bar;
  }
  const beat = beatSec(analysis.bpm);
  const k = Math.floor((afterSec - analysis.beatGridOffsetSec) / beat) + 1;
  return analysis.beatGridOffsetSec + k * beat;
}

/** The last bar line (trustworthy song map) or, failing that, beat at or before `sec`; never negative. */
export function gridPointAtOrBefore(analysis: TrackAnalysis, sec: number): number {
  const map = analysis.songMap;
  if (isPhraseGridTrustworthy(map)) {
    let best: number | null = null;
    for (const t of map.downbeats) {
      if (t <= sec) best = t;
      else break;
    }
    if (best != null) return Math.max(0, best);
  }
  const beat = beatSec(analysis.bpm);
  const k = Math.floor((sec - analysis.beatGridOffsetSec) / beat);
  return Math.max(0, analysis.beatGridOffsetSec + k * beat);
}

/**
 * The plan, once the outgoing track's voices are done and the pair qualifies, or null. Null (so the normal
 * transition runs) when the pair isn't mashable, the voices aren't done yet, or there isn't room left in the file
 * for at least VOCAL_MASHUP_MIN_HOLD_BARS of hold plus the hand-off.
 */
export function planVocalMashup(input: VocalMashupInput): VocalMashupPlan | null {
  const { current, next, currentTimeSec, currentDurationSec, voiceCutoffSec, nextFirstVoiceSec } = input;
  if (!isVocalMashupPair(current, next)) return null;
  if (voiceCutoffSec == null || currentTimeSec < voiceCutoffSec) return null;

  const bpm = current.analysis.bpm > 0 ? current.analysis.bpm : 120;
  const barSec = (4 * 60) / bpm;
  const startAt = nextGridPointAfter(current.analysis, currentTimeSec + MIN_LEAD_SEC);
  const startDelaySec = startAt - currentTimeSec;

  const handoffSec = VOCAL_MASHUP_HANDOFF_BARS * barSec;
  const available = currentDurationSec - startAt - END_MARGIN_SEC;
  const holdBars = Math.min(Math.round(VOCAL_MASHUP_HOLD_SEC / barSec), Math.floor((available - handoffSec) / barSec));
  if (holdBars < VOCAL_MASHUP_MIN_HOLD_BARS) return null;
  const holdSec = holdBars * barSec;

  const first = nextFirstVoiceSec ?? next.analysis.energyOnsetSec;
  const entryOffsetSec = gridPointAtOrBefore(next.analysis, first + 0.05);

  const tempoRatio = bestTempoRatio(current.analysis.bpm, next.analysis.bpm);
  const pitchSemitones = camelotSemitoneShift(current.analysis.camelotKey, next.analysis.camelotKey);
  const camelotScore =
    current.analysis.camelotKey && next.analysis.camelotKey ? (current.analysis.camelotKey === next.analysis.camelotKey ? 2 : 1) : 0;
  const pitchNote = pitchSemitones !== 0 ? `, shifted ${pitchSemitones > 0 ? "+" : ""}${pitchSemitones} semitones` : "";
  const rationale =
    `Vocal mashup — the singing in "${current.track.title}" is over, so "${next.track.title}"'s vocal rides its ` +
    `instrumental for ${holdBars} bars (tempo-matched${pitchNote}), then the rest of the track comes in.`;

  return {
    tempoRatio,
    pitchSemitones,
    startDelaySec,
    entryOffsetSec,
    introSec: VOCAL_MASHUP_INTRO_BARS * barSec,
    holdSec,
    handoffSec,
    totalSec: holdSec + handoffSec,
    holdBars,
    camelotScore,
    rationale,
  };
}

/** The plan in the shape the mashup runner and its hand-off already use. */
export function toMashupPlan(plan: VocalMashupPlan): MashupPlan {
  return {
    tempoRatio: plan.tempoRatio,
    pitchSemitones: plan.pitchSemitones,
    entryOffsetSec: plan.entryOffsetSec,
    barsCount: plan.holdBars + VOCAL_MASHUP_HANDOFF_BARS,
    durationSec: plan.totalSec,
    camelotScore: plan.camelotScore,
    rationale: plan.rationale,
  };
}

/** Which part of the mashup `elapsedSec` (from the vocal's entry) falls in. */
export function vocalMashupPhase(plan: VocalMashupPlan, elapsedSec: number): "holding" | "handoff" {
  return elapsedSec < plan.holdSec ? "holding" : "handoff";
}

export interface VocalMashupGains {
  /** The outgoing deck. */
  out: number;
  /** The incoming vocal. */
  vocal: number;
  /** The incoming instrumental. */
  inst: number;
}

/** Gains `elapsedSec` after the vocal's entry. Ends at out 0, vocal 1, inst 1: the incoming stems sum to its full mix. */
export function vocalMashupGainsAt(plan: VocalMashupPlan, elapsedSec: number): VocalMashupGains {
  const t = Math.max(0, Math.min(plan.totalSec, elapsedSec));
  const L = VOCAL_MASHUP_HOLD_LEVEL;
  if (t < plan.holdSec) {
    const intro = plan.introSec > 0 ? Math.min(1, t / plan.introSec) : 1;
    return { out: L, vocal: L * Math.sqrt(intro), inst: 0 };
  }
  const p = plan.handoffSec > 0 ? Math.min(1, (t - plan.holdSec) / plan.handoffSec) : 1;
  return {
    out: L * Math.cos((p * Math.PI) / 2),
    vocal: L + (1 - L) * p,
    inst: Math.sin((p * Math.PI) / 2),
  };
}

/** The three gains sampled across the whole mashup, for AudioParam.setValueCurveAtTime. */
export function vocalMashupGainCurves(
  plan: VocalMashupPlan,
  steps = 256
): { out: Float32Array; vocal: Float32Array; inst: Float32Array } {
  const out = new Float32Array(steps);
  const vocal = new Float32Array(steps);
  const inst = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const g = vocalMashupGainsAt(plan, (i / (steps - 1)) * plan.totalSec);
    out[i] = g.out;
    vocal[i] = g.vocal;
    inst[i] = g.inst;
  }
  return { out, vocal, inst };
}

/**
 * Tempo and pitch at `elapsedSec`: held at the match through the hold, then eased home across the hand-off so the
 * incoming track lands at its own speed and key.
 */
export function vocalMashupTempoPitchAt(plan: VocalMashupPlan, elapsedSec: number): { tempo: number; pitchSemitones: number } {
  if (elapsedSec <= plan.holdSec || plan.handoffSec <= 0) return { tempo: plan.tempoRatio, pitchSemitones: plan.pitchSemitones };
  const p = Math.min(1, (elapsedSec - plan.holdSec) / plan.handoffSec);
  return {
    tempo: plan.tempoRatio + (1 - plan.tempoRatio) * p,
    pitchSemitones: plan.pitchSemitones * (1 - p),
  };
}

/**
 * The incoming track's instrumental: its full mix minus its separated vocal, per channel and sample, clipped to
 * [-1, 1]. Demucs' stems sum back to the mix, so what is left is everything that isn't the vocal. A mono vocal is
 * subtracted from every channel; where the vocal is shorter the remainder is the mix untouched.
 */
export function instrumentalFromMixAndVocal(mix: Float32Array[], vocal: Float32Array[]): Float32Array[] {
  return mix.map((channel, c) => {
    const v = vocal.length === 0 ? null : vocal[Math.min(c, vocal.length - 1)];
    const out = new Float32Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i] - (v && i < v.length ? v[i] : 0);
      out[i] = sample > 1 ? 1 : sample < -1 ? -1 : sample;
    }
    return out;
  });
}
