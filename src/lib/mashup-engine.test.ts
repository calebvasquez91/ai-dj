import { describe, expect, it } from "vitest";
import { isMashupEligible, planMashup, MASHUP_MAX_TEMPO_DELTA, MASHUP_MIN_BARS, MASHUP_MAX_BARS } from "./mashup-engine";
import type { TrackAnalysis } from "./audio-analysis";
import type { Track } from "@/types/music";

function makeTrack(id: string, durationSec = 240): Track {
  return { id, title: id, artist: "Test Artist", durationSec, addedAt: 0, sourceUrl: `blob:${id}` };
}

function makeAnalysis(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return {
    bpm: 128,
    bpmConfidence: 0.8,
    beatGridOffsetSec: 0.2,
    energyOnsetSec: 8,
    key: "A minor",
    keyConfidence: 0.6,
    camelotKey: "8A",
    breakdownAtSec: null,
    dropAtSec: null,
    waveformPeaks: [],
    fallback: false,
    ...overrides,
  };
}

describe("isMashupEligible", () => {
  it("is eligible for confident, harmonically compatible, close-tempo tracks", () => {
    const current = { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 128, camelotKey: "8A" }) };
    const next = { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 130, camelotKey: "8A" }) };
    expect(isMashupEligible(current, next)).toBe(true);
  });

  it("rejects a pair with low tempo confidence", () => {
    const current = { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 128, camelotKey: "8A" }) };
    const next = { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 130, camelotKey: "8A", bpmConfidence: 0.1 }) };
    expect(isMashupEligible(current, next)).toBe(false);
  });

  it("rejects a pair with low key confidence", () => {
    const current = { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 128, camelotKey: "8A" }) };
    const next = { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 130, camelotKey: "8A", keyConfidence: 0.05 }) };
    expect(isMashupEligible(current, next)).toBe(false);
  });

  it("rejects harmonically incompatible keys", () => {
    const current = { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 128, camelotKey: "8A" }) };
    const next = { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 130, camelotKey: "3B" }) };
    expect(isMashupEligible(current, next)).toBe(false);
  });

  it("rejects a tempo gap wider than MASHUP_MAX_TEMPO_DELTA", () => {
    const current = { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 100, camelotKey: "8A" }) };
    const next = { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 150, camelotKey: "8A" }) };
    expect(isMashupEligible(current, next)).toBe(false);
  });

  it("accepts a tempo gap right at the edge of MASHUP_MAX_TEMPO_DELTA", () => {
    const current = { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 100, camelotKey: "8A" }) };
    const next = {
      track: makeTrack("b"),
      analysis: makeAnalysis({ bpm: 100 * (1 + MASHUP_MAX_TEMPO_DELTA - 0.02), camelotKey: "8A" }),
    };
    expect(isMashupEligible(current, next)).toBe(true);
  });
});

describe("planMashup", () => {
  it("returns null for an ineligible pair", () => {
    const current = { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 128, camelotKey: "8A" }) };
    const next = { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 128, camelotKey: "3B" }) };
    expect(planMashup(current, next)).toBeNull();
  });

  it("plans a bars count within the configured range", () => {
    const current = { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 128, camelotKey: "8A" }) };
    const next = { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 128, camelotKey: "8A" }) };
    const plan = planMashup(current, next);
    expect(plan).not.toBeNull();
    expect(plan!.barsCount).toBeGreaterThanOrEqual(MASHUP_MIN_BARS);
    expect(plan!.barsCount).toBeLessThanOrEqual(MASHUP_MAX_BARS);
    expect(plan!.durationSec).toBeGreaterThan(0);
  });

  it("uses a tempoRatio that brings the incoming track to the outgoing track's tempo", () => {
    const current = { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 128, camelotKey: "8A" }) };
    const next = { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 120, camelotKey: "8A" }) };
    const plan = planMashup(current, next);
    // next.bpm * tempoRatio should land on current.bpm
    expect(120 * plan!.tempoRatio).toBeCloseTo(128, 1);
  });

  it("applies zero pitch shift for identical keys", () => {
    const current = { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 128, camelotKey: "8A" }) };
    const next = { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 128, camelotKey: "8A" }) };
    expect(planMashup(current, next)!.pitchSemitones).toBe(0);
  });

  it("applies zero pitch shift for a relative-major/minor pair (same number, different letter)", () => {
    const current = { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 128, camelotKey: "8A" }) };
    const next = { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 128, camelotKey: "8B" }) };
    expect(planMashup(current, next)!.pitchSemitones).toBe(0);
  });

  it("applies a mode-safe semitone shift for an adjacent-wheel, same-letter pair", () => {
    const current = { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 128, camelotKey: "8A" }) };
    const next = { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 128, camelotKey: "9A" }) };
    const plan = planMashup(current, next);
    expect(plan!.pitchSemitones).not.toBe(0);
    expect(Math.abs(plan!.pitchSemitones)).toBeLessThanOrEqual(6);
  });

  it("never defaults the incoming entry point to zero when an energy onset was detected", () => {
    const current = { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 128, camelotKey: "8A" }) };
    const next = {
      track: makeTrack("b"),
      analysis: makeAnalysis({ bpm: 128, camelotKey: "8A", energyOnsetSec: 14.2 }),
    };
    expect(planMashup(current, next)!.entryOffsetSec).toBeGreaterThan(0);
  });
});
