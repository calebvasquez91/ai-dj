import type { Track } from "@/types/music";
import { genreFamilies } from "@/data/styles";
import { transitions, type TransitionCategory, type TransitionEntry } from "@/data/transitions";
import type { TrackAnalysis } from "@/lib/audio-analysis";

export const MIN_CROSSFADE_SEC = 3;
export const MAX_CROSSFADE_SEC = 30;
export const AUTO_DJ_OFF_FADE_SEC = 3;
/** Auto-DJ never lets a track ride past this much active playback before forcing a transition into the next queued track, regardless of the file's real length. */
export const MAX_ACTIVE_PLAY_SEC = 150;

/** How close (fractional, after best-octave adjustment) two BPMs need to be to tempo-sync, roughly a real turntable's pitch-fader range. */
const TEMPO_SYNC_MAX_DELTA = 0.08;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Equal-power crossfade curve: outGain^2 + inGain^2 stays constant at 1. */
export function equalPowerGains(progress: number): { outGain: number; inGain: number } {
  const p = clamp(progress, 0, 1);
  const angle = (p * Math.PI) / 2;
  return { outGain: Math.cos(angle), inGain: Math.sin(angle) };
}

/** Precomputed equal-power gain curves as Float32Arrays for AudioParam.setValueCurveAtTime. */
export function equalPowerCurves(steps = 64): { outCurve: Float32Array; inCurve: Float32Array } {
  const outCurve = new Float32Array(steps);
  const inCurve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const { outGain, inGain } = equalPowerGains(i / (steps - 1));
    outCurve[i] = outGain;
    inCurve[i] = inGain;
  }
  return { outCurve, inCurve };
}

/** BPM ratio (a/b) adjusted to whichever octave (1x, 2x, 0.5x) sits closest to 1 — treats double/half-tempo as compatible. */
function bestTempoRatio(bpmA: number, bpmB: number): number {
  if (bpmA <= 0 || bpmB <= 0) return 1;
  const raw = bpmA / bpmB;
  const candidates = [raw, raw * 2, raw / 2];
  return candidates.reduce((best, r) => (Math.abs(r - 1) < Math.abs(best - 1) ? r : best));
}

function snapToBeatGrid(timeSec: number, beatGridOffsetSec: number, bpm: number): number {
  if (bpm <= 0) return Math.max(0, timeSec);
  const beatLenSec = 60 / bpm;
  const beatsSinceOffset = (timeSec - beatGridOffsetSec) / beatLenSec;
  const snappedBeats = Math.round(beatsSinceOffset);
  return Math.max(0, beatGridOffsetSec + snappedBeats * beatLenSec);
}

function windowBeatsForTransition(t: TransitionEntry, tempoSync: boolean, bpmDelta: number): number {
  switch (t.category) {
    case "cut":
      // A real hard cut is near-instant; MIN_WINDOW_SEC_BY_CATEGORY (not
      // MIN_CROSSFADE_SEC) is what actually floors this in seconds.
      return t.id === "hard-cut" ? 0.25 : 1;
    case "scratch":
      // Transform Chop is a faster, more clipped toggle than a beat juggle.
      return t.id === "transform-chop" ? 2 : 4;
    case "brake":
      return 4;
    case "riser":
      return 16;
    case "blend":
      return tempoSync && bpmDelta < 0.03 ? 32 : 16;
    case "eq-filter":
      return tempoSync ? 16 : 8;
    case "eq-kill":
      return 8;
    case "reverb":
      return 12;
    case "drop":
      return 16;
    case "tempo-ramp":
      // Deliberately long — the whole point is a gradual, extended shift.
      return 64;
    case "tag-sample":
      return 2;
    case "effects":
      return 8;
    case "digital":
      return 16;
    default:
      return 8;
  }
}

/**
 * Per-category floor for the transition window, in seconds — a flat
 * MIN_CROSSFADE_SEC applied to every category would force even a "hard cut"
 * or scratch-style stutter into at least a multi-second crossfade, which is
 * exactly why cuts and chops used to sound like generic fades.
 */
const MIN_WINDOW_SEC_BY_CATEGORY: Record<TransitionCategory, number> = {
  cut: 0.15,
  scratch: 0.6,
  brake: 1.5,
  riser: 4,
  blend: MIN_CROSSFADE_SEC,
  "eq-filter": MIN_CROSSFADE_SEC,
  "eq-kill": MIN_CROSSFADE_SEC,
  reverb: MIN_CROSSFADE_SEC,
  drop: MIN_CROSSFADE_SEC,
  "tempo-ramp": 8,
  "tag-sample": 1.5,
  effects: MIN_CROSSFADE_SEC,
  digital: MIN_CROSSFADE_SEC,
  vocal: MIN_CROSSFADE_SEC,
};

export type TransitionEffect =
  | "none"
  | "highpass-sweep"
  | "lowpass-sweep"
  | "echo-tail"
  | "brake"
  | "riser"
  | "stutter-gate"
  | "eq-kill"
  | "reverb-wash"
  | "tag-sample";

const TRANSITION_EFFECT_BY_ID: Record<string, TransitionEffect> = {
  "bass-swap": "highpass-sweep",
  "filter-sweep": "lowpass-sweep",
  "echo-out": "echo-tail",
  spinback: "brake",
  "riser-uplift": "riser",
  "scratch-transition": "stutter-gate",
  "beat-juggle-transition": "stutter-gate",
  "transform-chop": "stutter-gate",
  "eq-kill-mix": "eq-kill",
  "reverb-wash": "reverb-wash",
  "tag-drop": "tag-sample",
};

/**
 * Gain shape for a "brake"/spinback transition: the outgoing track holds at
 * full volume while it's audibly slowing down (all the character is in the
 * pitch ramp, driven separately by playbackRate), then both decks
 * equal-power crossfade in the final stretch as the incoming track drops
 * in at full tempo.
 */
export function brakeGainCurves(
  steps = 64,
  dropStartRatio = 0.75
): { outCurve: Float32Array; inCurve: Float32Array } {
  const outCurve = new Float32Array(steps);
  const inCurve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const p = i / (steps - 1);
    if (p < dropStartRatio) {
      outCurve[i] = 1;
      inCurve[i] = 0;
    } else {
      const dropProgress = (p - dropStartRatio) / (1 - dropStartRatio);
      const { outGain, inGain } = equalPowerGains(dropProgress);
      outCurve[i] = outGain;
      inCurve[i] = inGain;
    }
  }
  return { outCurve, inCurve };
}

/**
 * Alternating hard on/off gain gate for scratch/beat-juggle-style
 * transitions — toggles between the outgoing and incoming deck, always
 * landing on the incoming deck for the final segment.
 */
export function stutterGateCurves(
  steps = 64,
  toggleCount = 8
): { outCurve: Float32Array; inCurve: Float32Array } {
  const outCurve = new Float32Array(steps);
  const inCurve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const p = i / (steps - 1);
    const toggleIndex = Math.min(toggleCount - 1, Math.floor(p * toggleCount));
    const incomingIsUp = toggleIndex % 2 === 1 || toggleIndex === toggleCount - 1;
    outCurve[i] = incomingIsUp ? 0 : 1;
    inCurve[i] = incomingIsUp ? 1 : 0;
  }
  return { outCurve, inCurve };
}

// ---------------------------------------------------------------------------
// Harmonic mixing — Camelot wheel key-compatibility scoring. This is a
// selection *input* (which transition/pairing reads as musically sound),
// not a distinct audible technique, so it feeds transition scoring rather
// than becoming its own TransitionEntry.
// ---------------------------------------------------------------------------

const MIN_KEY_CONFIDENCE_FOR_SCORING = 0.15;

function parseCamelotCode(code: string): { number: number; letter: "A" | "B" } | null {
  const m = code.match(/^(\d{1,2})([AB])$/);
  if (!m) return null;
  return { number: parseInt(m[1], 10), letter: m[2] as "A" | "B" };
}

/** 2 = identical key, 1 = relative major/minor or adjacent on the wheel, 0 = not compatible (or unknown). */
export function camelotCompatibility(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const pa = parseCamelotCode(a);
  const pb = parseCamelotCode(b);
  if (!pa || !pb) return 0;
  if (pa.number === pb.number && pa.letter === pb.letter) return 2;
  if (pa.number === pb.number) return 1;
  const diff = Math.min((pa.number - pb.number + 12) % 12, (pb.number - pa.number + 12) % 12);
  if (diff === 1 && pa.letter === pb.letter) return 1;
  return 0;
}

export interface TransitionContext {
  bpmDelta: number;
  tempoSync: boolean;
  genreHint: string | null;
  personaDjNames: string[];
  camelotScore?: number; // 0-2, from camelotCompatibility() — omit/0 when key confidence is too low to trust
}

function scoreTransition(t: TransitionEntry, ctx: TransitionContext): number {
  if (!t.executable) return -Infinity;
  let score = 0;
  score += ctx.bpmDelta <= t.idealBpmDeltaMax ? 10 : -5;
  if (ctx.genreHint) {
    if (t.idealGenres.includes(ctx.genreHint)) score += 6;
    else if (t.idealGenres.length > 0) score -= 2;
  }
  if (ctx.personaDjNames.some((name) => t.exampleDjs.includes(name))) score += 8;
  if (t.idealGenres.length === 0) score += 1;
  score += (ctx.camelotScore ?? 0) * 3;
  return score;
}

export function chooseTransition(ctx: TransitionContext): TransitionEntry {
  let best = transitions[0];
  let bestScore = -Infinity;
  for (const t of transitions) {
    const score = scoreTransition(t, ctx);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

export interface TransitionPlan {
  transitionId: string;
  category: TransitionCategory;
  windowSec: number;
  windowBeats: number;
  incomingEntryOffsetSec: number;
  tempoSync: boolean;
  tempoRatioStart: number; // incoming deck's playbackRate at transition start (1 = no adjustment)
  effect: TransitionEffect;
  rationale: string;
}

interface PlanTransitionArgs {
  current: { track: Track; analysis: TrackAnalysis };
  next: { track: Track; analysis: TrackAnalysis };
  genreHint?: string | null;
  overrideSec?: number | null;
  /** The outgoing track's current playback position, if known — enables phase-locking the incoming track's entry point to the outgoing track's current beat position (not just its own beat grid), so the downbeats actually land together instead of just matching tempo. */
  currentElapsedSec?: number | null;
}

function buildRationale(
  t: TransitionEntry,
  genreHint: string | null,
  tempoSync: boolean,
  camelotScore: number
): string {
  const genre = genreHint ? genreFamilies.find((g) => g.id === genreHint) : null;
  const djNames = (genre?.exampleDjs.length ? genre.exampleDjs : t.exampleDjs).slice(0, 2).join(" & ");
  const tempoNote = tempoSync ? "tempo-synced" : "beat-aligned";
  const harmonicNote = camelotScore >= 2 ? " Same key." : camelotScore === 1 ? " Harmonically compatible keys." : "";
  const base = djNames
    ? `${t.name}, ${genreHint ? `channeling ${djNames}'s ${genre?.name ?? ""} energy` : `in the style of ${djNames}`} — ${tempoNote}. ${t.description}`
    : `${t.name} — ${tempoNote}. ${t.description}`;
  return base + harmonicNote;
}

/**
 * Plans a musically-aware transition between two tracks: picks a transition
 * style from the repertoire in data/transitions.ts (factoring in tempo,
 * genre, persona, and Camelot-wheel key compatibility), sizes the overlap
 * window in beats (not an arbitrary second count), and snaps the incoming
 * track's entry point to its own beat grid near its energy-onset — never a
 * bare 0 — or, for a Double Drop, to land its own drop at the window's end.
 */
export function planTransition({
  current,
  next,
  genreHint = null,
  overrideSec = null,
  currentElapsedSec = null,
}: PlanTransitionArgs): TransitionPlan {
  const bpmDelta = Math.abs(bestTempoRatio(current.analysis.bpm, next.analysis.bpm) - 1);
  const tempoSync = bpmDelta <= TEMPO_SYNC_MAX_DELTA;
  const genreFamily = genreHint ? genreFamilies.find((g) => g.id === genreHint) : null;
  const personaDjNames = genreFamily?.exampleDjs ?? [];
  const camelotScore =
    current.analysis.keyConfidence >= MIN_KEY_CONFIDENCE_FOR_SCORING &&
    next.analysis.keyConfidence >= MIN_KEY_CONFIDENCE_FOR_SCORING
      ? camelotCompatibility(current.analysis.camelotKey, next.analysis.camelotKey)
      : 0;

  const transition = chooseTransition({ bpmDelta, tempoSync, genreHint, personaDjNames, camelotScore });

  const windowBeats = windowBeatsForTransition(transition, tempoSync, bpmDelta);
  const effectiveBpm = current.analysis.bpm > 0 ? current.analysis.bpm : 120;
  const minWindowSec = MIN_WINDOW_SEC_BY_CATEGORY[transition.category];
  const windowSec =
    overrideSec != null
      ? clamp(overrideSec, MIN_CROSSFADE_SEC, MAX_CROSSFADE_SEC)
      : clamp((windowBeats * 60) / effectiveBpm, minWindowSec, MAX_CROSSFADE_SEC);

  // A Tempo Ramp deliberately bridges a wider gap than normal tempoSync
  // allows, gradually, across its unusually long window — everything else
  // only attempts a tempo-ratio adjustment when tracks are already close.
  const attemptsTempoRatio = tempoSync || transition.category === "tempo-ramp";
  const tempoRatioStart = attemptsTempoRatio
    ? bestTempoRatio(current.analysis.bpm, next.analysis.bpm)
    : 1;

  // Double Drop: target the incoming track's own drop to land right at the
  // end of the window, instead of just its post-intro energy onset — the
  // whole point of this technique is the two drops coinciding.
  const baseEntryOffsetSec =
    transition.category === "drop" && next.analysis.dropAtSec != null
      ? snapToBeatGrid(
          Math.max(0, next.analysis.dropAtSec - windowSec),
          next.analysis.beatGridOffsetSec,
          next.analysis.bpm
        )
      : snapToBeatGrid(next.analysis.energyOnsetSec, next.analysis.beatGridOffsetSec, next.analysis.bpm);
  const latestSensibleEntrySec = Math.max(0, next.track.durationSec - MIN_CROSSFADE_SEC);

  // Phase-lock: snapping to the incoming track's own beat grid gets the
  // tempo right, but says nothing about where the outgoing track currently
  // sits within ITS beat cycle — so the two downbeats can still land apart
  // even though both tracks are on-tempo. Nudge the entry point forward by
  // the outgoing track's current sub-beat phase (converted into incoming-
  // track-time via the rate the incoming deck starts at) so the two
  // downbeats actually coincide the moment the incoming track starts.
  let entryOffsetSec = baseEntryOffsetSec;
  if (currentElapsedSec != null && current.analysis.bpm > 0) {
    const fromBeatLenSec = 60 / current.analysis.bpm;
    const fromPhaseSec =
      (((currentElapsedSec - current.analysis.beatGridOffsetSec) % fromBeatLenSec) + fromBeatLenSec) %
      fromBeatLenSec;
    entryOffsetSec += fromPhaseSec * tempoRatioStart;
  }
  const incomingEntryOffsetSec = clamp(entryOffsetSec, 0, latestSensibleEntrySec);

  return {
    transitionId: transition.id,
    category: transition.category,
    windowSec,
    windowBeats,
    incomingEntryOffsetSec,
    tempoSync,
    tempoRatioStart,
    effect: TRANSITION_EFFECT_BY_ID[transition.id] ?? "none",
    rationale: buildRationale(transition, genreHint, tempoSync, camelotScore),
  };
}

/** Simple flat-timer fade, used only for the Auto-DJ-off tail fade and as a last resort if audio decoding itself fails. */
export function planSimpleFade(windowSec = AUTO_DJ_OFF_FADE_SEC): TransitionPlan {
  return {
    transitionId: "hard-cut",
    category: "cut",
    windowSec: clamp(windowSec, 1, MAX_CROSSFADE_SEC),
    windowBeats: 0,
    incomingEntryOffsetSec: 0,
    tempoSync: false,
    tempoRatioStart: 1,
    effect: "none",
    rationale: "Simple fade (Auto-DJ off, or analysis unavailable).",
  };
}
