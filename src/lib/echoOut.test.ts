import { describe, expect, it } from "vitest";
import { applyEchoOut, detectAbruptEnding, ECHO_FEEDBACK, ECHO_OUT_TRANSITION_ID, entryPoint, HOLD_SILENCE_SEC, planEchoOut } from "./echoOut";
import { isOnBeat } from "./djMoves";
import type { ParamLike } from "./djEq";
import type { TrackAnalysis } from "./audio-analysis";

const BPM = 120;
const BEAT = 0.5;

function analysis(peaks: number[], over: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return { bpm: BPM, bpmConfidence: 0.9, beatGridOffsetSec: 0, energyOnsetSec: 8, key: null, keyConfidence: 0, camelotKey: null, breakdownAtSec: null, dropAtSec: null, buildDropPairs: [], waveformPeaks: peaks, fallback: false, ...over };
}

/** 400 buckets: loud (0.9) until `loudUntil`, then silent. */
const stops = (loudUntil: number) => Array.from({ length: 400 }, (_, i) => (i < loudUntil ? 0.9 : 0));
/** Loud until 340 then a long fade to nothing. */
const fades = () => Array.from({ length: 400 }, (_, i) => (i < 340 ? 0.9 : Math.max(0, 0.9 * (1 - (i - 340) / 55))));

describe("detectAbruptEnding", () => {
  it("knows a song that stops while loud, followed by silence", () => {
    const r = detectAbruptEnding(analysis(stops(392)), 200);
    expect(r.abrupt).toBe(true);
    expect(r.lastLoudSec).toBeCloseTo((392 / 400) * 200, 6);
  });
  it("knows a song that is cut off while still loud, with no silence at all", () => {
    expect(detectAbruptEnding(analysis(Array(400).fill(0.8)), 200).abrupt).toBe(true);
  });
  it("is not abrupt when the song fades out", () => {
    const r = detectAbruptEnding(analysis(fades()), 200);
    expect(r.abrupt).toBe(false);
    expect(r.reason).toMatch(/fades/);
  });
  it("is not abrupt when the ending is quiet to begin with", () => {
    expect(detectAbruptEnding(analysis(Array.from({ length: 400 }, (_, i) => (i < 392 ? 0.2 : 0))), 200).abrupt).toBe(false);
  });
  it("says no when there is no waveform to read", () => {
    expect(detectAbruptEnding(analysis([]), 200)).toMatchObject({ abrupt: false, lastLoudSec: null });
    expect(detectAbruptEnding(analysis(stops(392)), 0).abrupt).toBe(false);
  });
});

describe("entryPoint: where the next song comes in", () => {
  it("comes in on a downbeat at its drop, the most energetic part", () => {
    const a = analysis(stops(100), { dropAtSec: 61.3, buildDropPairs: [{ buildAtSec: 40, dropAtSec: 61.3 }] });
    const e = entryPoint(a, 200);
    expect(e.kind).toBe("peak");
    expect(isOnBeat(a, e.sec)).toBe(true);
    expect(Math.abs(e.sec - 61.3)).toBeLessThan(2.01); // the bar line at or before it (a bar is 2 s)
  });
  it("uses the loudest stretch when the song has no marked drop but a clear peak", () => {
    const peaks = Array.from({ length: 400 }, (_, i) => (i < 200 ? 0.2 : i < 260 ? 1 : 0.5));
    const e = entryPoint(analysis(peaks), 200);
    expect(e.kind).toBe("peak");
    expect(e.sec).toBeGreaterThanOrEqual(99);
    expect(e.sec).toBeLessThanOrEqual(131);
  });
  it("falls back to the first downbeat after the intro when there is no clear peak", () => {
    const a = analysis(Array(400).fill(0.5));
    const e = entryPoint(a, 200);
    expect(e.kind).toBe("after-intro");
    expect(e.sec).toBeGreaterThanOrEqual(8);
    expect(isOnBeat(a, e.sec)).toBe(true);
  });
});

describe("planEchoOut", () => {
  const out = analysis(stops(392), { beatGridOffsetSec: 0.1 });
  const next = analysis(stops(100), { dropAtSec: 60, buildDropPairs: [{ buildAtSec: 44, dropAtSec: 60 }] });
  const plan = (rand: () => number) => planEchoOut({ outgoing: out, outgoingDurationSec: 200, incoming: next, incomingDurationSec: 200, rand })!;

  it("echoes the last beat, locked to the tempo", () => {
    const p = plan(() => 0.5);
    expect(isOnBeat(out, p.echoStartSec)).toBe(true);
    expect(p.echoStartSec).toBeLessThanOrEqual(196);
    expect(p.echoStartSec).toBeGreaterThan(196 - BEAT * 2);
    expect(p.delayTimeSec).toBeCloseTo(BEAT * 0.75, 9); // a dotted eighth
    expect(p.feedback).toBe(ECHO_FEEDBACK);
    expect(p.tailSec).toBeGreaterThan(0);
    expect(p.tailSec).toBeLessThanOrEqual(4);
  });
  it("holds silence for 3 to 5 seconds, whatever the dice say", () => {
    expect(plan(() => 0).holdSilenceSec).toBe(HOLD_SILENCE_SEC.min);
    expect(plan(() => 1).holdSilenceSec).toBe(HOLD_SILENCE_SEC.max);
    expect(plan(() => 0.5).holdSilenceSec).toBe(4);
    for (let i = 0; i < 50; i++) {
      const h = planEchoOut({ outgoing: out, outgoingDurationSec: 200, incoming: next, incomingDurationSec: 200 })!.holdSilenceSec;
      expect(h).toBeGreaterThanOrEqual(3);
      expect(h).toBeLessThanOrEqual(5);
    }
  });
  it("starts the next song after the tail and the silence, at its peak on a downbeat", () => {
    const p = plan(() => 0.5);
    expect(p.nextStartAfterSec).toBeCloseTo(p.tailSec + p.holdSilenceSec, 9);
    expect(p.entryKind).toBe("peak");
    expect(isOnBeat(next, p.incomingEntrySec)).toBe(true);
    expect(p.reason).toMatch(/stops while it is still loud; echo, 4\.0 s of silence, then the next song at its peak/);
  });
  it("is for abrupt endings only: a faded song gets the normal transition", () => {
    expect(planEchoOut({ outgoing: analysis(fades()), outgoingDurationSec: 200, incoming: next, incomingDurationSec: 200 })).toBeNull();
    expect(planEchoOut({ outgoing: analysis(stops(392), { fallback: true }), outgoingDurationSec: 200, incoming: next, incomingDurationSec: 200 })).toBeNull();
  });
  it("is its own transition type, not part of the paused transition effects", () => {
    expect(ECHO_OUT_TRANSITION_ID).toBe("echo-out");
  });
});

class FakeParam implements ParamLike {
  value = 0;
  calls: [string, ...number[]][] = [];
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

describe("applyEchoOut", () => {
  const out = analysis(stops(392));
  const next = analysis(stops(100), { dropAtSec: 60 });
  const p = planEchoOut({ outgoing: out, outgoingDurationSec: 200, incoming: next, incomingDurationSec: 200, rand: () => 0.5 })!;
  it("sets the delay to the dotted eighth, sends one beat into it, then closes the send so only the echo remains", () => {
    const t = { delaySendGain: new FakeParam(), delayTime: new FakeParam(), feedbackGain: new FakeParam() };
    const dies = applyEchoOut(t, p, 100, 99);
    expect(t.delayTime.calls).toContainEqual(["set", p.delayTimeSec, 100]);
    expect(t.feedbackGain.calls).toContainEqual(["set", ECHO_FEEDBACK, 100]);
    expect(t.delaySendGain.calls).toContainEqual(["set", 1, 100]);
    expect(t.delaySendGain.calls).toContainEqual(["ramp", 0, 100 + BEAT]);
    expect(dies).toBeCloseTo(100 + BEAT + p.tailSec, 9);
  });
  it("never starts in the past", () => {
    const t = { delaySendGain: new FakeParam(), delayTime: new FakeParam(), feedbackGain: new FakeParam() };
    applyEchoOut(t, p, 10, 50);
    expect(t.delayTime.calls[0]).toEqual(["cancel", 50]);
  });
});
