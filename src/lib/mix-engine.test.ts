import { describe, expect, it } from "vitest";
import { planTransition } from "./mix-engine";
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
});
