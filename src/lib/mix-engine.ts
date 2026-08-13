import type { Track } from "@/types/music";
import { genreFamilies } from "@/data/styles";
import { transitions, type TransitionCategory, type TransitionEntry } from "@/data/transitions";
import type { TrackAnalysis } from "@/lib/audio-analysis";

export const MIN_CROSSFADE_SEC = 3;
export const MAX_CROSSFADE_SEC = 30;
export const AUTO_DJ_OFF_FADE_SEC = 3;

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
      return t.id === "hard-cut" ? 0.5 : 1;
    case "blend":
      return tempoSync && bpmDelta < 0.03 ? 32 : 16;
    case "eq-filter":
      return tempoSync ? 16 : 8;
    case "effects":
      return 8;
    case "digital":
      return 16;
    default:
      return 8;
  }
}

export type FilterAutomation = "none" | "highpass-sweep" | "lowpass-sweep" | "echo-tail";

const FILTER_AUTOMATION_BY_TRANSITION: Record<string, FilterAutomation> = {
  "bass-swap": "highpass-sweep",
  "filter-sweep": "lowpass-sweep",
  "echo-out": "echo-tail",
};

export interface TransitionContext {
  bpmDelta: number;
  tempoSync: boolean;
  genreHint: string | null;
  personaDjNames: string[];
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
  filterAutomation: FilterAutomation;
  rationale: string;
}

interface PlanTransitionArgs {
  current: { track: Track; analysis: TrackAnalysis };
  next: { track: Track; analysis: TrackAnalysis };
  genreHint?: string | null;
  overrideSec?: number | null;
}

function buildRationale(t: TransitionEntry, genreHint: string | null, tempoSync: boolean): string {
  const genre = genreHint ? genreFamilies.find((g) => g.id === genreHint) : null;
  const djNames = (genre?.exampleDjs.length ? genre.exampleDjs : t.exampleDjs).slice(0, 2).join(" & ");
  const tempoNote = tempoSync ? "tempo-synced" : "beat-aligned";
  return djNames
    ? `${t.name}, ${genreHint ? `channeling ${djNames}'s ${genre?.name ?? ""} energy` : `in the style of ${djNames}`} — ${tempoNote}. ${t.description}`
    : `${t.name} — ${tempoNote}. ${t.description}`;
}

/**
 * Plans a musically-aware transition between two tracks: picks a transition
 * style from the repertoire in data/transitions.ts, sizes the overlap window
 * in beats (not an arbitrary second count), and snaps the incoming track's
 * entry point to its own beat grid near its energy-onset — never a bare 0.
 */
export function planTransition({
  current,
  next,
  genreHint = null,
  overrideSec = null,
}: PlanTransitionArgs): TransitionPlan {
  const bpmDelta = Math.abs(bestTempoRatio(current.analysis.bpm, next.analysis.bpm) - 1);
  const tempoSync = bpmDelta <= TEMPO_SYNC_MAX_DELTA;
  const genreFamily = genreHint ? genreFamilies.find((g) => g.id === genreHint) : null;
  const personaDjNames = genreFamily?.exampleDjs ?? [];

  const transition = chooseTransition({ bpmDelta, tempoSync, genreHint, personaDjNames });

  const windowBeats = windowBeatsForTransition(transition, tempoSync, bpmDelta);
  const effectiveBpm = current.analysis.bpm > 0 ? current.analysis.bpm : 120;
  const windowSec =
    overrideSec != null
      ? clamp(overrideSec, MIN_CROSSFADE_SEC, MAX_CROSSFADE_SEC)
      : clamp((windowBeats * 60) / effectiveBpm, MIN_CROSSFADE_SEC, MAX_CROSSFADE_SEC);

  const snappedEntryOffsetSec = snapToBeatGrid(
    next.analysis.energyOnsetSec,
    next.analysis.beatGridOffsetSec,
    next.analysis.bpm
  );
  const latestSensibleEntrySec = Math.max(0, next.track.durationSec - MIN_CROSSFADE_SEC);
  const incomingEntryOffsetSec = clamp(snappedEntryOffsetSec, 0, latestSensibleEntrySec);

  const tempoRatioStart = tempoSync
    ? bestTempoRatio(current.analysis.bpm, next.analysis.bpm)
    : 1;

  return {
    transitionId: transition.id,
    category: transition.category,
    windowSec,
    windowBeats,
    incomingEntryOffsetSec,
    tempoSync,
    tempoRatioStart,
    filterAutomation: FILTER_AUTOMATION_BY_TRANSITION[transition.id] ?? "none",
    rationale: buildRationale(transition, genreHint, tempoSync),
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
    filterAutomation: "none",
    rationale: "Simple fade (Auto-DJ off, or analysis unavailable).",
  };
}
