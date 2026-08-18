import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_PLAY_SEC,
  brakeGainCurves,
  planTransition,
  stutterGateCurves,
} from "./mix-engine";
import type { TrackAnalysis } from "./audio-analysis";
import type { Track } from "@/types/music";

function makeTrack(id: string, durationSec: number): Track {
  return { id, title: id, artist: "Test Artist", durationSec, sourceUrl: `blob:${id}` };
}

function makeAnalysis(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return {
    bpm: 128,
    bpmConfidence: 0.8,
    beatGridOffsetSec: 0.2,
    energyOnsetSec: 8,
    key: "A minor",
    keyConfidence: 0.6,
    fallback: false,
    ...overrides,
  };
}

describe("planTransition", () => {
  it("picks a tempo-synced blend/eq-filter transition for close-BPM house/techno tracks", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 129 }) },
      genreHint: "techno",
    });
    expect(plan.tempoSync).toBe(true);
    expect(["blend", "eq-filter"]).toContain(plan.category);
    expect(plan.windowBeats).toBeGreaterThanOrEqual(8);
  });

  it("picks a cut transition for far-apart BPMs with a hip-hop persona", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 100 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 137 }) },
      genreHint: "hip-hop",
    });
    expect(plan.tempoSync).toBe(false);
    expect(plan.category).toBe("cut");
  });

  it("never defaults the incoming entry point to zero when an energy onset was detected", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 128, energyOnsetSec: 12.4 }) },
      genreHint: "house",
    });
    expect(plan.incomingEntryOffsetSec).not.toBe(0);
    expect(plan.incomingEntryOffsetSec).toBeGreaterThan(5);
  });

  it("snaps the incoming entry point to the next track's own beat grid", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128 }) },
      next: {
        track: makeTrack("b", 240),
        analysis: makeAnalysis({ bpm: 120, beatGridOffsetSec: 0.5, energyOnsetSec: 10.1 }),
      },
      genreHint: "house",
    });
    const beatLenSec = 60 / 120;
    const beatsFromOffset = (plan.incomingEntryOffsetSec - 0.5) / beatLenSec;
    expect(Math.abs(beatsFromOffset - Math.round(beatsFromOffset))).toBeLessThan(1e-6);
  });

  it("clamps the incoming entry point so it never lands too close to the track's end", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128 }) },
      next: {
        track: makeTrack("b", 30),
        analysis: makeAnalysis({ bpm: 128, energyOnsetSec: 28 }),
      },
      genreHint: "house",
    });
    expect(plan.incomingEntryOffsetSec).toBeLessThanOrEqual(27);
  });

  it("still derives the window from BPM (not a flat constant) even in a low-confidence fallback scenario", () => {
    const slow = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 100, fallback: true, bpmConfidence: 0 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 100, fallback: true, bpmConfidence: 0 }) },
      genreHint: "house",
    });
    const fast = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 175, fallback: true, bpmConfidence: 0 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 175, fallback: true, bpmConfidence: 0 }) },
      genreHint: "house",
    });
    expect(slow.windowSec).not.toBe(fast.windowSec);
    expect(slow.windowBeats).toBe(fast.windowBeats);
  });

  it("respects an explicit duration override while still picking a real transition style", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 128 }) },
      genreHint: "techno",
      overrideSec: 12,
    });
    expect(plan.windowSec).toBe(12);
    expect(plan.transitionId).not.toBe("");
  });

  it("produces a non-empty rationale mentioning the chosen transition", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 128 }) },
      genreHint: "techno",
    });
    expect(plan.rationale.length).toBeGreaterThan(0);
  });

  it("never floors a hard-cut/quick-chop window at the multi-second blend minimum", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 100 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 137 }) },
      genreHint: "hip-hop",
    });
    expect(plan.category).toBe("cut");
    expect(plan.windowSec).toBeLessThan(3);
  });

  it("respects an explicit crossfade override even for a cut-category pick", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 100 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 137 }) },
      genreHint: "hip-hop",
      overrideSec: 10,
    });
    expect(plan.windowSec).toBe(10);
  });

  it("phase-locks the incoming entry point to the outgoing track's current beat position when currentElapsedSec is given", () => {
    const current = { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128, beatGridOffsetSec: 0 }) };
    const next = {
      track: makeTrack("b", 240),
      analysis: makeAnalysis({ bpm: 128, beatGridOffsetSec: 0, energyOnsetSec: 16 }),
    };
    // 128 BPM beat length is 60/128 = 0.46875s. Elapsed 10.234375s is
    // exactly 1/4 of a beat (0.1171875s) past a beat boundary.
    const beatLenSec = 60 / 128;
    const fromPhaseSec = beatLenSec / 4;
    const withoutPhase = planTransition({ current, next });
    const withPhase = planTransition({ current, next, currentElapsedSec: 22 * beatLenSec + fromPhaseSec });
    expect(withPhase.incomingEntryOffsetSec - withoutPhase.incomingEntryOffsetSec).toBeCloseTo(
      fromPhaseSec,
      5
    );
  });

  it("does not shift the entry point when the outgoing track's elapsed time lands exactly on a beat", () => {
    const current = { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128, beatGridOffsetSec: 0 }) };
    const next = {
      track: makeTrack("b", 240),
      analysis: makeAnalysis({ bpm: 128, beatGridOffsetSec: 0, energyOnsetSec: 16 }),
    };
    const beatLenSec = 60 / 128;
    const withoutPhase = planTransition({ current, next });
    const withPhase = planTransition({ current, next, currentElapsedSec: 30 * beatLenSec });
    expect(withPhase.incomingEntryOffsetSec).toBeCloseTo(withoutPhase.incomingEntryOffsetSec, 5);
  });
});

describe("MAX_ACTIVE_PLAY_SEC", () => {
  it("caps active playback well under a typical track length", () => {
    expect(MAX_ACTIVE_PLAY_SEC).toBeGreaterThan(60);
    expect(MAX_ACTIVE_PLAY_SEC).toBeLessThan(240);
  });
});

describe("brakeGainCurves", () => {
  it("holds the outgoing deck at full volume and the incoming deck silent until the drop point", () => {
    const { outCurve, inCurve } = brakeGainCurves(20, 0.75);
    expect(outCurve[0]).toBe(1);
    expect(inCurve[0]).toBe(0);
    expect(outCurve[10]).toBe(1); // 10/19 ≈ 0.53, still before the 0.75 drop point
    expect(inCurve[10]).toBe(0);
  });

  it("crossfades to the incoming deck by the end of the curve", () => {
    const { outCurve, inCurve } = brakeGainCurves(20, 0.75);
    expect(outCurve[19]).toBeCloseTo(0, 5);
    expect(inCurve[19]).toBeCloseTo(1, 5);
  });
});

describe("stutterGateCurves", () => {
  it("only ever has one deck audible at a time", () => {
    const { outCurve, inCurve } = stutterGateCurves(32, 8);
    for (let i = 0; i < 32; i++) {
      expect(outCurve[i] + inCurve[i]).toBe(1);
    }
  });

  it("always ends on the incoming deck", () => {
    const { outCurve, inCurve } = stutterGateCurves(32, 8);
    expect(outCurve[31]).toBe(0);
    expect(inCurve[31]).toBe(1);
  });

  it("toggles between decks more than once across the window", () => {
    const { inCurve } = stutterGateCurves(32, 8);
    let toggles = 0;
    for (let i = 1; i < 32; i++) {
      if (inCurve[i] !== inCurve[i - 1]) toggles++;
    }
    expect(toggles).toBeGreaterThan(1);
  });
});
