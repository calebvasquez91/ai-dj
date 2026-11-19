import { describe, expect, it } from "vitest";
import { applyEqMove, EQ_HIGH_LIFT_DB, EQ_MAX_CUT_BARS, EQ_LOW_CUT_DB, EQ_MIN_GAP_BARS, planEqMove, rampBeatsFor, runDjEqTick, type EqContext, type ParamLike } from "./djEq";
import { barsToSec, isOnBeat } from "./djMoves";
import type { TrackAnalysis } from "./audio-analysis";

const BPM = 128;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const DURATION = 240;

/** A song at 128 BPM whose waveform is quiet to start and loud from 25% on, with a build at 60 s and a drop at 70 s. */
function analysis(over: Partial<TrackAnalysis> = {}): TrackAnalysis {
  const peaks = Array.from({ length: 400 }, (_, i) => (i < 100 ? 0.15 : i < 160 ? 0.5 : 0.95));
  return {
    bpm: BPM,
    bpmConfidence: 0.9,
    beatGridOffsetSec: 0.2,
    energyOnsetSec: 0,
    key: null,
    keyConfidence: 0,
    camelotKey: null,
    breakdownAtSec: null,
    dropAtSec: 70,
    buildDropPairs: [{ buildAtSec: 60, dropAtSec: 70 }],
    waveformPeaks: peaks,
    fallback: false,
    ...over,
  };
}

const ctx = (over: Partial<EqContext> = {}): EqContext => ({ analysis: analysis(), durationSec: DURATION, currentTimeSec: 40, lastMoveAtSec: null, ...over });

describe("planEqMove: when a move is supported", () => {
  it("cuts the low end into a build, starting on a bar line just before it", () => {
    // 40 s is at 16% of the song (quiet), so use a loud moment in the song's second half to plan a build there
    const a = analysis({ buildDropPairs: [{ buildAtSec: 130, dropAtSec: 140 }] });
    const move = planEqMove(ctx({ analysis: a, currentTimeSec: 126 }))!;
    expect(move.kind).toBe("low-cut-into-build");
    expect(move.lowDb).toBe(EQ_LOW_CUT_DB);
    expect(move.startSec).toBeLessThanOrEqual(130);
    expect(move.startSec).toBeGreaterThanOrEqual(126);
    expect(isOnBeat(a, move.startSec)).toBe(true);
    expect(move.reason).toMatch(/energy 1\.00, 128 BPM, build in \d+ bars/);
  });

  it("brings the bass back on the drop, on the bar of the drop", () => {
    const a = analysis({ buildDropPairs: [{ buildAtSec: 100, dropAtSec: 140 }] });
    const move = planEqMove(ctx({ analysis: a, currentTimeSec: 136 }))!;
    expect(move.kind).toBe("bass-return-on-drop");
    expect(move.lowDb).toBe(0);
    expect(isOnBeat(a, move.startSec)).toBe(true);
    expect(Math.abs(move.startSec - 140)).toBeLessThan(BAR);
    expect(move.reason).toMatch(/drop in \d+ bars/);
  });

  it("lifts the highs in a peak with nothing else going on", () => {
    const a = analysis({ buildDropPairs: [] });
    const move = planEqMove(ctx({ analysis: a, currentTimeSec: 150 }))!;
    expect(move.kind).toBe("high-lift-in-peak");
    expect(move.highDb).toBe(EQ_HIGH_LIFT_DB);
    expect(move.holdSec).toBeGreaterThan(0);
    expect(isOnBeat(a, move.startSec)).toBe(true);
  });

  it("swaps the bass in a hand-off, on a bar, and says when the bass stem is used", () => {
    const a = analysis({ buildDropPairs: [] });
    const move = planEqMove(ctx({ analysis: a, currentTimeSec: 150, handoff: { atSec: 153, bassStemReady: true } }))!;
    expect(move.kind).toBe("bass-swap");
    expect(move.lowDb).toBe(EQ_LOW_CUT_DB);
    expect(move.incomingLow).toEqual({ from: EQ_LOW_CUT_DB, to: 0 });
    expect(move.usesBassStem).toBe(true);
    expect(move.reason).toMatch(/bass stem/);
    expect(isOnBeat(a, move.startSec)).toBe(true);
  });
});

describe("planEqMove: when it is not", () => {
  const a = analysis({ buildDropPairs: [] });
  it("does nothing when the song is not energetic enough at that moment", () => {
    expect(planEqMove(ctx({ analysis: a, currentTimeSec: 20 }))).toBeNull(); // the quiet start
  });
  it("does nothing outside the tempo range, or with no usable analysis", () => {
    expect(planEqMove(ctx({ analysis: analysis({ bpm: 60, buildDropPairs: [] }), currentTimeSec: 150 }))).toBeNull();
    expect(planEqMove(ctx({ analysis: analysis({ bpm: 200, buildDropPairs: [] }), currentTimeSec: 150 }))).toBeNull();
    expect(planEqMove(ctx({ analysis: analysis({ fallback: true, buildDropPairs: [] }), currentTimeSec: 150 }))).toBeNull();
  });
  it("does nothing when the waveform is too even to say how energetic the song is", () => {
    expect(planEqMove(ctx({ analysis: analysis({ waveformPeaks: Array(400).fill(0.8), buildDropPairs: [] }), currentTimeSec: 150 }))).toBeNull();
  });
  it("allows no more than one move per eight bars", () => {
    const eight = barsToSec(EQ_MIN_GAP_BARS, BPM);
    expect(planEqMove(ctx({ analysis: a, currentTimeSec: 150, lastMoveAtSec: 150 - eight + 0.5 }))).toBeNull();
    expect(planEqMove(ctx({ analysis: a, currentTimeSec: 150, lastMoveAtSec: 150 - eight }))).not.toBeNull();
  });
  it("is never random: the same moment always plans the same move", () => {
    const first = planEqMove(ctx({ analysis: a, currentTimeSec: 150 }));
    for (let i = 0; i < 20; i++) expect(planEqMove(ctx({ analysis: a, currentTimeSec: 150 }))).toEqual(first);
  });
  it("plans nothing for a build too far ahead to be this move's business", () => {
    const far = analysis({ buildDropPairs: [{ buildAtSec: 200, dropAtSec: 210 }] });
    expect(planEqMove(ctx({ analysis: far, currentTimeSec: 120, handoff: null }))?.kind).not.toBe("low-cut-into-build");
  });
});

describe("rampBeatsFor", () => {
  it("is one to four beats, shorter at a higher tempo", () => {
    expect(rampBeatsFor(100)).toBe(4);
    expect(rampBeatsFor(128)).toBe(3);
    expect(rampBeatsFor(170)).toBe(2);
    expect(rampBeatsFor(170, 1)).toBe(1);
    for (const bpm of [60, 90, 128, 150, 180]) {
      const n = rampBeatsFor(bpm);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(4);
    }
  });
});

class FakeParam implements ParamLike {
  value: number;
  calls: [string, ...number[]][] = [];
  constructor(value = 0) {
    this.value = value;
  }
  cancelScheduledValues(t: number) {
    this.calls.push(["cancel", t]);
  }
  setValueAtTime(v: number, t: number) {
    this.calls.push(["set", v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(["ramp", v, t]);
  }
}

describe("applyEqMove and runDjEqTick: automation on the audio clock", () => {
  const a = analysis({ buildDropPairs: [] });
  const target = () => ({ lowShelfGain: new FakeParam(0), highShelfGain: new FakeParam(0), incomingLowShelfGain: new FakeParam(EQ_LOW_CUT_DB) });

  it("ramps the low shelf over the move's beats, from where it is to the target", () => {
    const t = target();
    const move = planEqMove(ctx({ analysis: a, currentTimeSec: 150, handoff: { atSec: 153, bassStemReady: false } }))!;
    applyEqMove(t, move, 500, 499);
    expect(t.lowShelfGain.calls).toEqual([["cancel", 500], ["set", 0, 500], ["ramp", EQ_LOW_CUT_DB, 500 + move.rampSec]]);
    expect(t.incomingLowShelfGain.calls.at(-1)).toEqual(["ramp", 0, 500 + move.rampSec]);
  });

  it("never schedules in the past", () => {
    const t = target();
    const move = planEqMove(ctx({ analysis: a, currentTimeSec: 150 }))!;
    applyEqMove(t, move, 10, 20);
    expect(t.highShelfGain.calls[0]).toEqual(["cancel", 20]);
  });

  it("holds a high lift for its bars, then brings the highs back to flat", () => {
    const t = target();
    const move = planEqMove(ctx({ analysis: a, currentTimeSec: 150 }))!;
    applyEqMove(t, move, 100, 99);
    const ramps = t.highShelfGain.calls.filter((c) => c[0] === "ramp");
    expect(ramps[0][1]).toBe(EQ_HIGH_LIFT_DB);
    expect(ramps[1][1]).toBe(0);
    expect(ramps[1][2]).toBeCloseTo(100 + move.rampSec + move.holdSec! + move.rampSec, 6);
  });

  it("a tick maps the song position to the audio clock, and does nothing when switched off", () => {
    const t = target();
    const off = runDjEqTick({ ...ctx({ analysis: a, currentTimeSec: 150 }), target: t, ctxNow: 50, playbackRate: 1, enabled: false });
    expect(off).toBeNull();
    expect(t.highShelfGain.calls).toEqual([]);
    const move = runDjEqTick({ ...ctx({ analysis: a, currentTimeSec: 150 }), target: t, ctxNow: 50, playbackRate: 1, enabled: true })!;
    const expectedStart = 50 + (move.startSec - 150);
    expect(t.highShelfGain.calls[0]).toEqual(["cancel", Math.max(expectedStart, 50)]);
  });
});

describe("a low cut is always undone", () => {
  // build at 130 s, drop at 135 s (a short build: under the eight-bar gap), all in the loud second half
  const a = analysis({ buildDropPairs: [{ buildAtSec: 130, dropAtSec: 135 }] });
  const cutAt = 128;

  it("brings the bass back on the drop even when it is less than eight bars after the cut", () => {
    const move = planEqMove(ctx({ analysis: a, currentTimeSec: 132, lastMoveAtSec: cutAt, cutAtSec: cutAt }))!;
    expect(move.kind).toBe("bass-return-on-drop");
    expect(move.lowDb).toBe(0);
    expect(isOnBeat(a, move.startSec)).toBe(true);
    expect(Math.abs(move.startSec - 135)).toBeLessThan(BAR);
  });
  it("does it at once on the next bar when the drop has already gone by", () => {
    const move = planEqMove(ctx({ analysis: a, currentTimeSec: 140, lastMoveAtSec: cutAt, cutAtSec: cutAt }))!;
    expect(move.kind).toBe("bass-return-on-drop");
    expect(move.reason).toMatch(/drop has landed/);
    expect(move.startSec - 140).toBeLessThan(BAR + 1e-6);
  });
  it("does it after sixteen bars when no drop ever comes", () => {
    const none = analysis({ buildDropPairs: [] });
    const waiting = planEqMove(ctx({ analysis: none, currentTimeSec: cutAt + 3 * BAR, lastMoveAtSec: cutAt, cutAtSec: cutAt }));
    expect(waiting).toBeNull();
    const move = planEqMove(ctx({ analysis: none, currentTimeSec: cutAt + EQ_MAX_CUT_BARS * BAR, lastMoveAtSec: cutAt, cutAtSec: cutAt }))!;
    expect(move.reason).toMatch(/build is over/);
  });
  it("does not need the energy or the tempo range: a cut is never left in place", () => {
    const quiet = analysis({ buildDropPairs: [{ buildAtSec: 20, dropAtSec: 30 }], bpm: 60 });
    expect(planEqMove(ctx({ analysis: quiet, currentTimeSec: 32, lastMoveAtSec: 18, cutAtSec: 18 }))?.kind).toBe("bass-return-on-drop");
  });
  it("plans nothing else while a cut is waiting to be undone", () => {
    const peak = analysis({ buildDropPairs: [{ buildAtSec: 130, dropAtSec: 200 }] });
    expect(planEqMove(ctx({ analysis: peak, currentTimeSec: 150, lastMoveAtSec: cutAt, cutAtSec: cutAt }))).toBeNull();
  });
});
