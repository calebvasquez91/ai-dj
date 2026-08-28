import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldTriggerAmbience } from "./ambience";
import type { TrackAnalysis } from "./audio-analysis";

// 100 one-second-wide peak buckets over a 100s track — keeps the mapping
// between array index and playback second trivially 1:1 for these tests.
const DURATION_SEC = 100;

function makeAnalysis(peaks: number[], overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return {
    bpm: 128,
    bpmConfidence: 0.8,
    beatGridOffsetSec: 0,
    energyOnsetSec: 0,
    key: null,
    keyConfidence: 0,
    camelotKey: null,
    breakdownAtSec: null,
    dropAtSec: null,
    waveformPeaks: peaks,
    fallback: false,
    ...overrides,
  };
}

function flatPeaks(value: number, length = DURATION_SEC): number[] {
  return new Array(length).fill(value);
}

describe("shouldTriggerAmbience", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when ambience is off", () => {
    const peaks = flatPeaks(0.2).map((v, i) => (i >= 66 && i < 70 ? 0.9 : v));
    const analysis = makeAnalysis(peaks, { dropAtSec: 75 });
    const cue = shouldTriggerAmbience({
      analysis,
      durationSec: DURATION_SEC,
      currentTimeSec: 70,
      lastTriggeredSec: null,
      frequency: "off",
    });
    expect(cue).toBeNull();
  });

  it("fires a riser cue on a sharp energy rise approaching a detected drop, most of the time", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.05); // TEMP: below the temporarily-biased riser/backspin split — takes the riser branch
    const peaks = flatPeaks(0.2).map((v, i) => (i >= 66 && i < 70 ? 0.9 : v));
    const analysis = makeAnalysis(peaks, { dropAtSec: 75 });
    const cue = shouldTriggerAmbience({
      analysis,
      durationSec: DURATION_SEC,
      currentTimeSec: 70,
      lastTriggeredSec: null,
      frequency: "occasional",
    });
    expect(cue).toEqual({ effect: "riser", windowSec: 6 });
  });

  it("fires a backspin cue on a build, occasionally", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9); // above the riser share — takes the backspin branch
    const peaks = flatPeaks(0.2).map((v, i) => (i >= 66 && i < 70 ? 0.9 : v));
    const analysis = makeAnalysis(peaks, { dropAtSec: 75 });
    const cue = shouldTriggerAmbience({
      analysis,
      durationSec: DURATION_SEC,
      currentTimeSec: 70,
      lastTriggeredSec: null,
      frequency: "occasional",
    });
    expect(cue).toEqual({ effect: "backspin", windowSec: 2 });
  });

  it("does not fire a build cue when the detected drop is too far ahead", () => {
    const peaks = flatPeaks(0.2).map((v, i) => (i >= 66 && i < 70 ? 0.9 : v));
    const analysis = makeAnalysis(peaks, { dropAtSec: 95 }); // 25s ahead > BUILD_LOOKAHEAD_SEC
    const cue = shouldTriggerAmbience({
      analysis,
      durationSec: DURATION_SEC,
      currentTimeSec: 70,
      lastTriggeredSec: null,
      frequency: "occasional",
    });
    expect(cue).toBeNull();
  });

  it("respects the cooldown for the given frequency", () => {
    const peaks = flatPeaks(0.2).map((v, i) => (i >= 66 && i < 70 ? 0.9 : v));
    const analysis = makeAnalysis(peaks, { dropAtSec: 75 });
    const cue = shouldTriggerAmbience({
      analysis,
      durationSec: DURATION_SEC,
      currentTimeSec: 70,
      lastTriggeredSec: 65, // only 5s ago, well under "occasional"'s 45s cooldown
      frequency: "occasional",
    });
    expect(cue).toBeNull();
  });

  it("fires an echo-tail cue on arrival at a detected breakdown, most of the time", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1); // lands in echo-tail's share of the split
    const analysis = makeAnalysis(flatPeaks(0.2), { breakdownAtSec: 40 });
    const cue = shouldTriggerAmbience({
      analysis,
      durationSec: DURATION_SEC,
      currentTimeSec: 42,
      lastTriggeredSec: null,
      frequency: "occasional",
    });
    expect(cue).toEqual({ effect: "echo-tail", windowSec: 3 });
  });

  it("fires the bigger vocal-echo cue on a detected breakdown, occasionally", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // lands in vocal-echo's share of the split
    const analysis = makeAnalysis(flatPeaks(0.2), { breakdownAtSec: 40 });
    const cue = shouldTriggerAmbience({
      analysis,
      durationSec: DURATION_SEC,
      currentTimeSec: 42,
      lastTriggeredSec: null,
      frequency: "occasional",
    });
    expect(cue).toEqual({ effect: "vocal-echo", windowSec: 9 });
  });

  it("fires a beat-aligned drum-break loop cue on a detected breakdown, occasionally", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.7); // lands in drum-break's share of the split
    const analysis = makeAnalysis(flatPeaks(0.2), { breakdownAtSec: 40, bpm: 128 });
    const cue = shouldTriggerAmbience({
      analysis,
      durationSec: DURATION_SEC,
      currentTimeSec: 42,
      lastTriggeredSec: null,
      frequency: "occasional",
    });
    expect(cue?.effect).toBe("drum-break");
    if (cue?.effect === "drum-break") {
      expect(cue.barsCount).toBeGreaterThanOrEqual(2);
      expect(cue.barsCount).toBeLessThanOrEqual(4);
      expect(cue.repeatCount).toBeGreaterThanOrEqual(3);
      expect(cue.repeatCount).toBeLessThanOrEqual(5);
      expect(cue.windowSec).toBeCloseTo((cue.barsCount * cue.repeatCount * 4 * 60) / 128, 5);
    }
  });

  it("fires an acapella-drop cue on a detected breakdown, occasionally", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9); // lands in acapella-drop's share of the split
    const analysis = makeAnalysis(flatPeaks(0.2), { breakdownAtSec: 40 });
    const cue = shouldTriggerAmbience({
      analysis,
      durationSec: DURATION_SEC,
      currentTimeSec: 42,
      lastTriggeredSec: null,
      frequency: "occasional",
    });
    expect(cue).toEqual({ effect: "acapella-drop", windowSec: 8 });
  });

  it("falls back to a peaks-derived lull when no breakdownAtSec was detected", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const peaks = flatPeaks(0.6).map((v, i) => (i >= 76 && i < 80 ? 0.2 : v));
    const analysis = makeAnalysis(peaks);
    const cue = shouldTriggerAmbience({
      analysis,
      durationSec: DURATION_SEC,
      currentTimeSec: 80,
      lastTriggeredSec: null,
      frequency: "occasional",
    });
    expect(cue).toEqual({ effect: "echo-tail", windowSec: 3 });
  });

  it("returns null on flat, unremarkable energy with no drop or breakdown", () => {
    const analysis = makeAnalysis(flatPeaks(0.5));
    const cue = shouldTriggerAmbience({
      analysis,
      durationSec: DURATION_SEC,
      currentTimeSec: 50,
      lastTriggeredSec: null,
      frequency: "occasional",
    });
    expect(cue).toBeNull();
  });
});
