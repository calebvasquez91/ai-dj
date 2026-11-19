// DJ EQ moves (behind DJ_EQ_ENABLED): the DJ moves the low and high EQ of the playing deck the way a person would, but only when the song's tempo and
// energy support it, and only on a beat or phrase boundary of its grid. Never random. The moves are a low cut into a build, the bass back on the
// drop, a high-shelf lift in a peak, and a bass swap in a hand-off between two songs (the bass stem, when there is one, makes that swap clean).
// Each ramps over one to four beats (fewer at a high tempo), scheduled on the audio clock, and no more than one move happens per eight bars. Pure:
// planEqMove decides, applyEqMove writes the automation to the two EQ parameters, and runDjEqTick does both for the player's clock tick.
import type { TrackAnalysis } from "@/lib/audio-analysis";
import { barsToSec, barsUntil, beatLengthSec, energyAt, gapElapsed, nextBoundary } from "@/lib/djMoves";

/** No more than one EQ move in this many bars. */
export const EQ_MIN_GAP_BARS = 8;
/** The song must be at least this energetic (0-1, for its own range) at the moment of a move. */
export const EQ_MIN_ENERGY = 0.5;
/** A move is planned this many bars ahead of the moment it is for, and no further. */
export const EQ_LOOKAHEAD_BARS = 4;
/** Tempos the moves are allowed at. */
export const EQ_BPM_RANGE = { min: 80, max: 180 } as const;
/** Below this the low end is "cut", above it a boost is "lifted". */
export const EQ_LOW_CUT_DB = -24;
export const EQ_HIGH_LIFT_DB = 4;

export type EqMoveKind = "low-cut-into-build" | "bass-return-on-drop" | "high-lift-in-peak" | "bass-swap";

export interface EqMove {
  kind: EqMoveKind;
  /** Where in the song the move starts (a beat or bar boundary of its grid), seconds. */
  startSec: number;
  rampBeats: number;
  rampSec: number;
  /** Target of the low shelf (dB) at the end of the ramp, for the playing deck; undefined when it does not move. */
  lowDb?: number;
  /** Target of the high shelf (dB). */
  highDb?: number;
  /** For a lift: how long it is held before the high shelf comes back to flat. */
  holdSec?: number;
  /** For a bass swap: the incoming deck's low shelf goes from `from` to `to` over the same ramp. */
  incomingLow?: { from: number; to: number };
  /** The bass swap used the bass stem. */
  usesBassStem: boolean;
  /** Shown in the DJ readout, e.g. "energy 0.82, 128 BPM, drop in 4 bars". */
  reason: string;
}

export interface EqContext {
  analysis: TrackAnalysis;
  durationSec: number;
  currentTimeSec: number;
  /** Where in the song the last move started, or null when none has. */
  lastMoveAtSec: number | null;
  /** A hand-off to the next song that this deck is about to make: the moment the outgoing song's bass should leave, and whether the bass stem is ready. */
  handoff?: { atSec: number; bassStemReady: boolean } | null;
  bpmRange?: { min: number; max: number };
  minEnergy?: number;
  /** Where in the song a low cut started that has not been undone yet, or null/undefined when the low end is in place. While it is set, the planner's only job is to bring the bass back. */
  cutAtSec?: number | null;
}

/** A low cut that has lasted this many bars without a drop to bring the bass back is undone anyway (the build is over). */
export const EQ_MAX_CUT_BARS = 16;

/** Fewer beats of ramp at a higher tempo (a ramp is a fixed feel, not a fixed number of seconds). */
export function rampBeatsFor(bpm: number, wanted = 4): number {
  const cap = bpm >= 150 ? 2 : bpm >= 120 ? 3 : 4;
  return Math.max(1, Math.min(wanted, cap));
}

function reasonLine(energy: number, bpm: number, tail: string): string {
  return `energy ${energy.toFixed(2)}, ${Math.round(bpm)} BPM, ${tail}`;
}

/**
 * Brings the bass back after a low cut. This is exempt from the one-move-per-eight-bars rule and from the energy gate: a cut must never be left
 * in place, however short the build was. It returns on the drop's bar line when a drop is coming, at once (on the next bar) when the drop has
 * already gone by, or once the cut has lasted EQ_MAX_CUT_BARS with no drop.
 */
function planBassReturn(ctx: EqContext): EqMove | null {
  const { analysis, durationSec, currentTimeSec: now } = ctx;
  const bpm = analysis.bpm;
  const beat = beatLengthSec(bpm);
  const horizon = now + barsToSec(EQ_LOOKAHEAD_BARS, bpm);
  const energy = energyAt(analysis, now, durationSec) ?? 0;
  const make = (start: number, tail: string): EqMove => {
    const rampBeats = rampBeatsFor(bpm, 1);
    return { kind: "bass-return-on-drop", startSec: start, rampBeats, rampSec: rampBeats * beat, lowDb: 0, usesBassStem: false, reason: reasonLine(energy, bpm, tail) };
  };
  const drops = analysis.buildDropPairs.map((p) => p.dropAtSec).filter((d) => d >= (ctx.cutAtSec ?? 0));
  const upcoming = drops.filter((d) => d >= now && d <= horizon).sort((a, b) => a - b)[0];
  if (upcoming !== undefined) {
    const start = nextBoundary(analysis, upcoming - 1e-3, "bar");
    if (start != null) return make(start, `drop in ${barsUntil(start, now, bpm)} bars`);
  }
  const passed = drops.some((d) => d < now);
  const tooLong = now - (ctx.cutAtSec ?? now) >= barsToSec(EQ_MAX_CUT_BARS, bpm);
  if (passed || tooLong) {
    const start = nextBoundary(analysis, now, "bar");
    if (start != null) return make(start, passed ? "the drop has landed" : "the build is over");
  }
  return null;
}

/** The next EQ move for the playing song, or null when none is supported right now (wrong tempo, too little energy, too soon after the last, or no grid). */
export function planEqMove(ctx: EqContext): EqMove | null {
  const { analysis, durationSec, currentTimeSec: now } = ctx;
  const bpm = analysis.bpm;
  const range = ctx.bpmRange ?? EQ_BPM_RANGE;
  if (analysis.fallback || !(bpm > 0)) return null;
  if (ctx.cutAtSec != null) return planBassReturn(ctx); // undo the cut first, whatever the tempo, gap or energy
  if (!(bpm >= range.min && bpm <= range.max)) return null;
  if (!gapElapsed(ctx.lastMoveAtSec, now, barsToSec(EQ_MIN_GAP_BARS, bpm))) return null;
  const energy = energyAt(analysis, now, durationSec);
  const minEnergy = ctx.minEnergy ?? EQ_MIN_ENERGY;
  if (energy == null || energy < minEnergy) return null;

  const beat = beatLengthSec(bpm);
  const horizon = now + barsToSec(EQ_LOOKAHEAD_BARS, bpm);
  const candidates: EqMove[] = [];

  // A bass swap in the hand-off: the outgoing bass leaves and the incoming one arrives together, on the bar the hand-off falls on.
  if (ctx.handoff && ctx.handoff.atSec >= now && ctx.handoff.atSec <= horizon) {
    const start = nextBoundary(analysis, ctx.handoff.atSec - 1e-3, "bar");
    if (start != null) {
      const rampBeats = rampBeatsFor(bpm, 2);
      candidates.push({
        kind: "bass-swap",
        startSec: start,
        rampBeats,
        rampSec: rampBeats * beat,
        lowDb: EQ_LOW_CUT_DB,
        incomingLow: { from: EQ_LOW_CUT_DB, to: 0 },
        usesBassStem: ctx.handoff.bassStemReady,
        reason: reasonLine(energy, bpm, `bass swap in ${barsUntil(start, now, bpm)} bars${ctx.handoff.bassStemReady ? " (bass stem)" : ""}`),
      });
    }
  }

  // The builds and drops the song's own analysis found: the low end leaves just before a build and comes back on the drop.
  for (const pair of analysis.buildDropPairs) {
    if (pair.buildAtSec >= now && pair.buildAtSec <= horizon) {
      const start = nextBoundary(analysis, pair.buildAtSec - barsToSec(1, bpm) - 1e-3, "bar");
      if (start != null && start >= now) {
        const rampBeats = rampBeatsFor(bpm, 4);
        candidates.push({
          kind: "low-cut-into-build",
          startSec: start,
          rampBeats,
          rampSec: rampBeats * beat,
          lowDb: EQ_LOW_CUT_DB,
          usesBassStem: false,
          reason: reasonLine(energy, bpm, `build in ${barsUntil(pair.buildAtSec, now, bpm)} bars`),
        });
      }
    }
    if (pair.dropAtSec >= now && pair.dropAtSec <= horizon) {
      const start = nextBoundary(analysis, pair.dropAtSec - 1e-3, "bar");
      if (start != null) {
        const rampBeats = rampBeatsFor(bpm, 1);
        candidates.push({
          kind: "bass-return-on-drop",
          startSec: start,
          rampBeats,
          rampSec: rampBeats * beat,
          lowDb: 0,
          usesBassStem: false,
          reason: reasonLine(energy, bpm, `drop in ${barsUntil(pair.dropAtSec, now, bpm)} bars`),
        });
      }
    }
  }

  // A peak with nothing else going on: lift the highs for a few bars.
  if (candidates.length === 0 && energy >= 0.8) {
    const start = nextBoundary(analysis, now, "bar");
    if (start != null) {
      const rampBeats = rampBeatsFor(bpm, 2);
      candidates.push({
        kind: "high-lift-in-peak",
        startSec: start,
        rampBeats,
        rampSec: rampBeats * beat,
        highDb: EQ_HIGH_LIFT_DB,
        holdSec: barsToSec(4, bpm),
        usesBassStem: false,
        reason: reasonLine(energy, bpm, "in a peak"),
      });
    }
  }

  candidates.sort((a, b) => a.startSec - b.startSec);
  return candidates[0] ?? null;
}

/** The two EQ parameters of one deck, and the one of the deck coming in for a bass swap. Anything with AudioParam's scheduling calls fits. */
export interface ParamLike {
  value: number;
  cancelScheduledValues(startTime: number): unknown;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
}
export interface EqTarget {
  lowShelfGain: ParamLike;
  highShelfGain: ParamLike;
  incomingLowShelfGain?: ParamLike | null;
}

/**
 * Writes a move's automation on the audio clock. `startCtxTime` is the audio-clock time of the move's start (the caller converts from the song's
 * position, so a move lands on its beat however the clock and the playhead drift). Never starts before `nowCtxTime`.
 */
export function applyEqMove(target: EqTarget, move: EqMove, startCtxTime: number, nowCtxTime: number): void {
  const start = Math.max(startCtxTime, nowCtxTime);
  const end = start + move.rampSec;
  const ramp = (param: ParamLike, to: number, from = param.value) => {
    param.cancelScheduledValues(start);
    param.setValueAtTime(from, start);
    param.linearRampToValueAtTime(to, end);
  };
  if (move.lowDb !== undefined) ramp(target.lowShelfGain, move.lowDb);
  if (move.highDb !== undefined) {
    ramp(target.highShelfGain, move.highDb);
    if (move.holdSec !== undefined) {
      const back = end + move.holdSec;
      target.highShelfGain.setValueAtTime(move.highDb, back);
      target.highShelfGain.linearRampToValueAtTime(0, back + move.rampSec);
    }
  }
  if (move.incomingLow && target.incomingLowShelfGain) ramp(target.incomingLowShelfGain, move.incomingLow.to, move.incomingLow.from);
}

export interface EqTickInput extends EqContext {
  target: EqTarget;
  /** The audio clock now, and the song position (seconds) that the audio clock reading belongs to, with the playback rate, so a song position maps to a clock time. */
  ctxNow: number;
  playbackRate: number;
  enabled: boolean;
}

/** One tick of the player's clock: plan, and if there is a move, schedule it. Returns the move (for the readout) or null. */
export function runDjEqTick(input: EqTickInput): EqMove | null {
  if (!input.enabled) return null;
  const move = planEqMove(input);
  if (!move) return null;
  const startCtx = input.ctxNow + (move.startSec - input.currentTimeSec) / Math.max(0.1, input.playbackRate);
  applyEqMove(input.target, move, startCtx, input.ctxNow);
  return move;
}
