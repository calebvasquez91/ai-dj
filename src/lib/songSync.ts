/**
 * Song Sync Mode — "Track A morphs into Track B". The playing track's tempo and pitch bend, bar by bar, until they
 * match the incoming track's; only then does a plain four-bar crossfade hand over. No effects, loops or ambient layers
 * are involved (see TRANSITION_FX_ENABLED in syncEngine.ts): just the two songs.
 *
 * Everything here is pure: the plan (how long, how far, which way), the ramps, the crossfade volumes, the rule that
 * decides when an automatic sync should start, and the wording the DJ board shows. DualDeckStage runs it on real audio.
 *
 * Why "morph" is measured in A's own bars: A is the only audible track while it bends, so progress is how far through
 * its bars it has played, whatever the tempo is doing at that moment. The tempo and pitch targets are moved linearly
 * across those bars, landing exactly on the incoming track's values at the final downbeat.
 */
import type { SyncReport } from "@/lib/syncEngine";
import { MAX_ACTIVE_PLAY_SEC } from "@/lib/mix-engine";
import type { SongMap, SongSectionLabel } from "@/lib/song-map";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** The volume hand-over lasts this many bars, with one table row per bar (SONG_SYNC_CROSSFADE_STEPS). */
export const SONG_SYNC_CROSSFADE_BARS = 4;

/** Beats between the moment an automatic sync starts and the mix-out point, on top of the morph itself: the crossfade. */
export const SONG_SYNC_TAIL_BEATS = 16;

/** Past this tempo gap (after folding to the nearest octave) a morph would sound like a different song speeding up, so the pair isn't morphed. */
export const SONG_SYNC_MAX_RATE_DELTA = 0.25;

/** The most the pitch is ever bent, in semitones either way. */
export const SONG_SYNC_MAX_PITCH_SEMITONES = 6;

/** The shortest morph worth doing when a late trigger has to squeeze it. */
export const SONG_SYNC_MIN_MORPH_BARS = 2;

/** Tempo gap, in BPM, under which no tempo morph is needed ("the same tempo"). */
export const SONG_SYNC_HOLD_BPM = 0.5;

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** Bars the morph takes for a tempo gap of `bpmDelta` BPM: the larger the move, the longer it is spread out. */
export function morphBarsForBpmDelta(bpmDelta: number): number {
  const d = Math.abs(bpmDelta);
  if (d <= 2) return 4;
  if (d <= 6) return 8;
  if (d <= 12) return 12;
  return 16;
}

/** Bars a pitch move needs at the least: a couple of semitones can be quick, a fifth cannot. */
export function morphBarsForPitchShift(semitones: number): number {
  const s = Math.abs(semitones);
  if (s === 0) return 0;
  if (s <= 2) return 4;
  if (s <= 4) return 8;
  return 12;
}

export type SongSyncDirection = "faster" | "slower" | "hold";

export interface SongSyncPlan {
  /** How many of A's bars the tempo and pitch take to arrive. */
  morphBars: number;
  /** A's tempo before the morph and the tempo it arrives at (B's, folded to A's octave), BPM. */
  bpmFrom: number;
  bpmTo: number;
  /** bpmTo / bpmFrom: the playback ratio A reaches (1 = untouched). */
  rateTarget: number;
  direction: SongSyncDirection;
  /** Semitones A is moved by the end (signed); 0 when the keys already agree or are unknown. */
  pitchTargetSemitones: number;
  keyFrom: string;
  keyTo: string;
  /** B's own tempo, unfolded: what the crossfade runs at when B is half or double A's reading. */
  bpmB: number;
}

export type SongSyncRefusal = "tempo-unknown" | "tempo-gap";

export interface SongSyncOverrides {
  morphBars?: number;
  pitchShiftSemitones?: number;
}

type PlanReport = Pick<
  SyncReport,
  | "trackA_bpm"
  | "trackB_bpm"
  | "trackB_bpmMatched"
  | "tempoConfident"
  | "trackA_key"
  | "trackB_key"
  | "morphPitchShiftSemitones"
>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The morph for A -> B, from the sync engine's report, or the reason there isn't one (the DJ then uses its ordinary
 * transition). Without a trusted tempo on both sides the bars can't be matched; past SONG_SYNC_MAX_RATE_DELTA the
 * stretch would be a different song. A key that is already compatible, unknown, or off the wheel is left alone.
 */
export function planSongSync(
  report: PlanReport,
  overrides: SongSyncOverrides = {}
): { ok: true; plan: SongSyncPlan } | { ok: false; reason: SongSyncRefusal } {
  if (!report.tempoConfident || !(report.trackA_bpm > 0) || !(report.trackB_bpmMatched > 0)) {
    return { ok: false, reason: "tempo-unknown" };
  }
  const rateRaw = report.trackB_bpmMatched / report.trackA_bpm;
  if (Math.abs(rateRaw - 1) > SONG_SYNC_MAX_RATE_DELTA) return { ok: false, reason: "tempo-gap" };

  const bpmDelta = Math.abs(report.trackB_bpmMatched - report.trackA_bpm);
  const hold = bpmDelta < SONG_SYNC_HOLD_BPM;
  const rateTarget = hold ? 1 : rateRaw;
  const pitch = clamp(
    Math.round(overrides.pitchShiftSemitones ?? report.morphPitchShiftSemitones),
    -SONG_SYNC_MAX_PITCH_SEMITONES,
    SONG_SYNC_MAX_PITCH_SEMITONES
  );
  const wantedBars = Math.max(morphBarsForBpmDelta(bpmDelta), morphBarsForPitchShift(pitch));
  const morphBars = Math.round(clamp(overrides.morphBars ?? wantedBars, SONG_SYNC_MIN_MORPH_BARS, 16));

  return {
    ok: true,
    plan: {
      morphBars,
      bpmFrom: report.trackA_bpm,
      bpmTo: hold ? report.trackA_bpm : report.trackB_bpmMatched,
      rateTarget,
      direction: hold ? "hold" : rateTarget > 1 ? "faster" : "slower",
      pitchTargetSemitones: pitch,
      keyFrom: report.trackA_key,
      keyTo: report.trackB_key,
      bpmB: report.trackB_bpm,
    },
  };
}

/**
 * Fits the morph into the room left on the playing track: it needs its bars, a bar of slack to land on a downbeat,
 * and the crossfade. Shortens the morph (never below SONG_SYNC_MIN_MORPH_BARS) when the room is tight, and returns
 * null when even the shortest morph doesn't fit (the caller then uses the ordinary transition).
 */
export function fitMorphToRoom(plan: SongSyncPlan, remainingSec: number): SongSyncPlan | null {
  const barSec = (4 * 60) / plan.bpmFrom;
  const barsLeft = Math.floor(remainingSec / barSec) - SONG_SYNC_CROSSFADE_BARS - 1;
  if (barsLeft >= plan.morphBars) return plan;
  if (barsLeft < SONG_SYNC_MIN_MORPH_BARS) return null;
  return { ...plan, morphBars: barsLeft };
}

// ---------------------------------------------------------------------------
// The ramps
// ---------------------------------------------------------------------------

export interface SongSyncMorphState {
  /** 0-1 through the morph. */
  progress: number;
  /** A's playback ratio right now. */
  rate: number;
  /** A's tempo right now, BPM. */
  bpm: number;
  /** Pitch shift right now, semitones. */
  pitchSemitones: number;
}

/** Where the morph stands after `barsElapsed` of A's bars: tempo and pitch both move linearly and arrive together. */
export function songSyncStateAt(plan: SongSyncPlan, barsElapsed: number): SongSyncMorphState {
  const progress = clamp(barsElapsed / plan.morphBars, 0, 1);
  const rate = 1 + (plan.rateTarget - 1) * progress;
  return {
    progress,
    rate,
    bpm: plan.bpmFrom * rate,
    pitchSemitones: plan.pitchTargetSemitones * progress,
  };
}

/**
 * Real seconds A takes to play from `fromBar` to `toBar` of the morph. A bar is `barSrcSec` of the track's own time;
 * while the tempo ramps, the same bar takes 1/rate of that on the clock, so this integrates 1/rate across the bars.
 */
export function morphRealSeconds(plan: SongSyncPlan, fromBar: number, toBar: number, barSrcSec: number): number {
  if (toBar <= fromBar) return 0;
  const STEPS = 64;
  const span = toBar - fromBar;
  let total = 0;
  for (let i = 0; i < STEPS; i++) {
    const mid = fromBar + ((i + 0.5) / STEPS) * span;
    total += ((span / STEPS) * barSrcSec) / songSyncStateAt(plan, mid).rate;
  }
  return total;
}

// ---------------------------------------------------------------------------
// The crossfade
// ---------------------------------------------------------------------------

/** Per bar of the crossfade: A's volume at the start and end of the bar, then B's. */
export const SONG_SYNC_CROSSFADE_STEPS: readonly (readonly [number, number, number, number])[] = [
  [1.0, 0.75, 0.0, 0.25],
  [0.75, 0.4, 0.25, 0.6],
  [0.4, 0.1, 0.6, 0.9],
  [0.1, 0.0, 0.9, 1.0],
];

/** Both volumes `barsIn` bars (0-4) into the crossfade: a straight line within each bar, landing on the table's values on the downbeats. */
export function songSyncCrossfadeGainsAt(barsIn: number): { a: number; b: number } {
  const t = clamp(barsIn, 0, SONG_SYNC_CROSSFADE_BARS);
  const bar = Math.min(SONG_SYNC_CROSSFADE_BARS - 1, Math.floor(t));
  const frac = t - bar;
  const [aFrom, aTo, bFrom, bTo] = SONG_SYNC_CROSSFADE_STEPS[bar];
  return { a: aFrom + (aTo - aFrom) * frac, b: bFrom + (bTo - bFrom) * frac };
}

/** The crossfade as curves for AudioParam.setValueCurveAtTime over its whole length. */
export function songSyncCrossfadeCurves(pointsPerBar = 16): { a: Float32Array; b: Float32Array } {
  const n = SONG_SYNC_CROSSFADE_BARS * pointsPerBar;
  const a = new Float32Array(n + 1);
  const b = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const g = songSyncCrossfadeGainsAt((i / n) * SONG_SYNC_CROSSFADE_BARS);
    a[i] = g.a;
    b[i] = g.b;
  }
  return { a, b };
}

// ---------------------------------------------------------------------------
// When an automatic sync starts
// ---------------------------------------------------------------------------

/** The moment A must be fully out by: the end of the file, never past the engine's active-play cap. */
export function songSyncMixOutSec(durationSec: number): number {
  return Math.min(durationSec, MAX_ACTIVE_PLAY_SEC);
}

/** Beats of A left until its mix-out point at A's tempo (negative once past it). */
export function beatsUntilMixOut(currentSec: number, durationSec: number, bpm: number): number {
  const beatSec = 60 / (bpm > 0 ? bpm : 120);
  return (songSyncMixOutSec(durationSec) - currentSec) / beatSec;
}

/** Beats before the mix-out point at which an automatic sync should start: the morph, then the crossfade. */
export function songSyncLeadBeats(morphBars: number): number {
  return morphBars * 4 + SONG_SYNC_TAIL_BEATS;
}

export type SongSyncTrigger = "wait" | "start";

/**
 * Whether an automatic sync starts now. It starts once the lead (the morph plus the crossfade) is all that is left
 * before the mix-out point, and it waits while the playing track is inside a drop, the best part of the song, for as
 * long as there is slack. That slack is two bars; after it, or once the mix-out point has passed, it starts anyway.
 */
export function songSyncTrigger(input: {
  beatsUntilMixOut: number;
  morphBars: number;
  section: SongSectionLabel | null;
}): SongSyncTrigger {
  const lead = songSyncLeadBeats(input.morphBars);
  if (input.beatsUntilMixOut > lead) return "wait";
  if (input.section === "drop" && input.beatsUntilMixOut > lead - 8) return "wait";
  return "start";
}

/** The section the time falls in, null without a song map. */
export function sectionLabelAt(map: SongMap | null | undefined, timeSec: number): SongSectionLabel | null {
  if (!map) return null;
  const hit = map.sections.find((s) => timeSec >= s.startSec && timeSec < s.endSec);
  return hit?.label ?? null;
}

// ---------------------------------------------------------------------------
// What the DJ board says
// ---------------------------------------------------------------------------

export type SongSyncPhase = "analyzing" | "morphing" | "aligning" | "locked" | "crossfading" | "done";

/** Mirror of the real morph, written only by DualDeckStage: the DJ board reads it, never drives it. */
export interface SongSyncStatus {
  phase: SongSyncPhase;
  nextTitle: string;
  /** "A: 128.00 BPM / A minor  ->  B: 132.00 BPM / C minor" */
  headline: string;
  /** "Plan: speed up +3.1% over 8 bars, shift pitch +3 semitones" */
  planLine: string;
  morphBars: number;
  /** Whole bars of the morph played so far. */
  bar: number;
  bpmFrom: number;
  bpmTo: number;
  bpmNow: number;
  keyFrom: string;
  keyTo: string;
  pitchTarget: number;
  pitchNow: number;
  /** How far A and B are from lined up, ms, once measured; null before. */
  phaseErrorMs: number | null;
  /** One sentence for the listener, from the AI DJ (or the local fallback). */
  listenerNote: string | null;
}

function signed(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

/** The plan's "how": speed up / slow down / hold, how much, over how many bars, and the pitch move if any. */
export function describeSongSyncPlanLine(plan: SongSyncPlan): string {
  const bars = `${plan.morphBars} bars`;
  const percent = (plan.rateTarget - 1) * 100;
  const tempo =
    plan.direction === "hold"
      ? `hold the tempo for ${bars}`
      : `${plan.direction === "faster" ? "speed up" : "slow down"} ${signed(percent, 1)}% over ${bars}`;
  const s = plan.pitchTargetSemitones;
  const pitch = s === 0 ? "" : `, shift pitch ${signed(s, 0)} semitone${Math.abs(s) === 1 ? "" : "s"}`;
  return `Plan: ${tempo}${pitch}`;
}

export function describeSongSyncHeadline(plan: SongSyncPlan): string {
  return `A: ${plan.bpmFrom.toFixed(2)} BPM / ${plan.keyFrom}  →  B: ${plan.bpmTo.toFixed(2)} BPM / ${plan.keyTo}`;
}

/** "Bar 3 of 8 — 128.94 BPM" */
export function describeSongSyncBpmRow(status: Pick<SongSyncStatus, "bar" | "morphBars" | "bpmNow">): string {
  return `Bar ${status.bar} of ${status.morphBars} — ${status.bpmNow.toFixed(2)} BPM`;
}

/** "+1.5 of +3 semitones" */
export function describeSongSyncKeyRow(status: Pick<SongSyncStatus, "pitchNow" | "pitchTarget">): string {
  const n = Math.abs(status.pitchTarget);
  return `${signed(Math.round(status.pitchNow * 10) / 10, 1)} of ${signed(status.pitchTarget, 0)} semitone${n === 1 ? "" : "s"}`;
}

/** A status line to show before anything has played: the analysis is done, the plan is known. */
export function initialSongSyncStatus(plan: SongSyncPlan, nextTitle: string, phase: SongSyncPhase = "analyzing"): SongSyncStatus {
  return {
    phase,
    nextTitle,
    headline: describeSongSyncHeadline(plan),
    planLine: describeSongSyncPlanLine(plan),
    morphBars: plan.morphBars,
    bar: 0,
    bpmFrom: plan.bpmFrom,
    bpmTo: plan.bpmTo,
    bpmNow: plan.bpmFrom,
    keyFrom: plan.keyFrom,
    keyTo: plan.keyTo,
    pitchTarget: plan.pitchTargetSemitones,
    pitchNow: 0,
    phaseErrorMs: null,
    listenerNote: null,
  };
}
