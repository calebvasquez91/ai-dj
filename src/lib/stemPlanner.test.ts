import { describe, expect, it } from "vitest";
import { fallbackAnalysis, type TrackAnalysis } from "./audio-analysis-core";
import type { SongMap } from "./song-map";
import {
  STEM_MAX_DURATION_SEC,
  STEM_MIN_DURATION_SEC,
  STEM_WORTH_IT_SCORE,
  judgeStemCandidate,
  judgeStemCandidates,
} from "./stemPlanner";

/** Quiet / loud / mid thirds: enough dynamics to read as a profile. */
const DYNAMIC_PEAKS = Array.from({ length: 240 }, (_, i) => (i < 80 ? 0.1 : i < 160 ? 0.9 : 0.5));
const FLAT_PEAKS = new Array(240).fill(0.6);

function trustedMap(): SongMap {
  const downbeats = Array.from({ length: 40 }, (_, i) => i * 2);
  return {
    version: 1,
    durationSec: 80,
    bpm: 120,
    tempoConfidence: 0.7,
    beatsPerBar: 4,
    beats: [],
    downbeatPhase: 0,
    downbeatConfidence: 0.8,
    downbeats,
    phrases: { bars8: [], bars16: [], bars32: [], confidence: 0.5 },
    sections: [],
  };
}

function analysis(over: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return { ...fallbackAnalysis(), fallback: false, bpm: 124, bpmConfidence: 0.8, waveformPeaks: DYNAMIC_PEAKS, ...over };
}

const track = (over: Partial<{ id: string; source: string; durationSec: number }> = {}) => ({
  id: "t1",
  source: "local",
  durationSec: 210,
  ...over,
});

describe("judgeStemCandidate", () => {
  it("gives a full-featured track a top score and every role", () => {
    const v = judgeStemCandidate({
      track: track(),
      analysis: analysis({ songMap: trustedMap(), dropAtSec: 60, keyConfidence: 0.8 }),
      hasLyrics: true,
    });
    expect(v.score).toBe(100);
    expect(v.worthIt).toBe(true);
    expect([...v.roles].sort()).toEqual(["bass", "drums", "melody", "vocals"]);
    expect(v.reasons).toEqual(expect.arrayContaining(["clear tempo", "reliable bar grid", "real dynamics", "a clear drop", "has vocals"]));
  });

  it("is worth it with a clear tempo, dynamics and vocals even without a bar grid or drop", () => {
    const v = judgeStemCandidate({ track: track(), analysis: analysis(), hasLyrics: true });
    expect(v.score).toBe(25 + 20 + 20);
    expect(v.worthIt).toBe(true);
  });

  it("is not worth it for a flat, vocal-less track even with a clear tempo", () => {
    const v = judgeStemCandidate({ track: track(), analysis: analysis({ waveformPeaks: FLAT_PEAKS }), hasLyrics: false });
    expect(v.score).toBe(25);
    expect(v.worthIt).toBe(false);
  });

  it("scores a workable but not strong tempo lower", () => {
    const strong = judgeStemCandidate({ track: track(), analysis: analysis({ bpmConfidence: 0.8 }), hasLyrics: true });
    const workable = judgeStemCandidate({ track: track(), analysis: analysis({ bpmConfidence: 0.4 }), hasLyrics: true });
    const unclear = judgeStemCandidate({ track: track(), analysis: analysis({ bpmConfidence: 0.1 }), hasLyrics: true });
    expect(strong.score).toBeGreaterThan(workable.score);
    expect(workable.score).toBeGreaterThan(unclear.score);
    expect(unclear.reasons).toContain("unclear tempo");
  });

  it("rejects what can't or shouldn't be separated, with a reason and no roles", () => {
    const base = { analysis: analysis(), hasLyrics: true };
    expect(judgeStemCandidate({ ...base, track: track({ source: "youtube" }) })).toMatchObject({ worthIt: false, score: 0, roles: [] });
    expect(judgeStemCandidate({ ...base, track: track({ durationSec: STEM_MIN_DURATION_SEC - 1 }) }).reasons).toEqual(["too short"]);
    expect(judgeStemCandidate({ ...base, track: track({ durationSec: STEM_MAX_DURATION_SEC + 1 }) }).worthIt).toBe(false);
    expect(judgeStemCandidate({ track: track(), analysis: undefined, hasLyrics: true }).reasons).toEqual(["not analysed yet"]);
    expect(judgeStemCandidate({ track: track(), analysis: fallbackAnalysis(), hasLyrics: true }).worthIt).toBe(false);
  });

  it("accepts the exact duration bounds", () => {
    const base = { analysis: analysis(), hasLyrics: true };
    expect(judgeStemCandidate({ ...base, track: track({ durationSec: STEM_MIN_DURATION_SEC }) }).worthIt).toBe(true);
    expect(judgeStemCandidate({ ...base, track: track({ durationSec: STEM_MAX_DURATION_SEC }) }).worthIt).toBe(true);
  });

  it("uses the documented threshold", () => {
    expect(STEM_WORTH_IT_SCORE).toBe(55);
  });
});

describe("judgeStemCandidates", () => {
  it("keeps the order it is given (nearest queue position first)", () => {
    const verdicts = judgeStemCandidates([
      { track: track({ id: "a" }), analysis: analysis(), hasLyrics: true },
      { track: track({ id: "b", source: "youtube" }), analysis: undefined, hasLyrics: false },
      { track: track({ id: "c" }), analysis: analysis(), hasLyrics: false },
    ]);
    expect(verdicts.map((v) => v.trackId)).toEqual(["a", "b", "c"]);
    expect(verdicts.map((v) => v.worthIt)).toEqual([true, false, false]);
  });
});
