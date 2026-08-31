import { describe, expect, it, vi, afterEach } from "vitest";
import { buildCompatibleOrder, scoreCompatibility, type SequencingCandidate } from "./track-sequencing";
import type { Track } from "@/types/music";
import type { TrackAnalysis } from "@/lib/audio-analysis";
import { fingerprintFromText } from "@/lib/lyrics";

function makeTrack(id: string): Track {
  return { id, title: id, artist: "Test Artist", durationSec: 200, addedAt: 0, source: "local", sourceUrl: `blob:${id}` };
}

function makeAnalysis(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return {
    bpm: 128,
    bpmConfidence: 0.8,
    beatGridOffsetSec: 0,
    energyOnsetSec: 0,
    key: "A minor",
    keyConfidence: 0.8,
    camelotKey: "8A",
    breakdownAtSec: null,
    dropAtSec: null,
    waveformPeaks: [0.5, 0.5, 0.5],
    fallback: false,
    ...overrides,
  };
}

function candidate(id: string, analysis: TrackAnalysis | null, fingerprint?: SequencingCandidate["lyricalFingerprint"]): SequencingCandidate {
  return { track: makeTrack(id), analysis, lyricalFingerprint: fingerprint };
}

describe("scoreCompatibility", () => {
  it("scores an identical tempo/key/energy pair highly", () => {
    const a = candidate("a", makeAnalysis());
    const b = candidate("b", makeAnalysis());
    expect(scoreCompatibility(a, b)).toBeGreaterThan(0.7);
  });

  it("scores a wildly different tempo lower than a close one", () => {
    const a = candidate("a", makeAnalysis({ bpm: 128 }));
    const close = candidate("close", makeAnalysis({ bpm: 130 }));
    const far = candidate("far", makeAnalysis({ bpm: 90 }));
    expect(scoreCompatibility(a, close)).toBeGreaterThan(scoreCompatibility(a, far));
  });

  it("scores harmonically compatible keys higher than clashing ones", () => {
    const a = candidate("a", makeAnalysis({ camelotKey: "8A" }));
    const sameKey = candidate("same", makeAnalysis({ camelotKey: "8A" }));
    const clashing = candidate("clash", makeAnalysis({ camelotKey: "2B" }));
    expect(scoreCompatibility(a, sameKey)).toBeGreaterThan(scoreCompatibility(a, clashing));
  });

  it("ignores key when confidence is too low to trust", () => {
    const a = candidate("a", makeAnalysis({ camelotKey: "8A", keyConfidence: 0.05 }));
    const b = candidate("b", makeAnalysis({ camelotKey: "2B", keyConfidence: 0.8 }));
    const c = candidate("c", makeAnalysis({ camelotKey: "8A", keyConfidence: 0.8 }));
    // a's own low confidence should suppress the key component entirely,
    // so b (clashing key) and c (same key) score identically against it.
    expect(scoreCompatibility(a, b)).toBeCloseTo(scoreCompatibility(a, c), 5);
  });

  it("rewards similar energy over wildly different energy", () => {
    const a = candidate("a", makeAnalysis({ waveformPeaks: [0.5, 0.5] }));
    const similar = candidate("similar", makeAnalysis({ waveformPeaks: [0.55, 0.45] }));
    const different = candidate("different", makeAnalysis({ waveformPeaks: [0.05, 0.05] }));
    expect(scoreCompatibility(a, similar)).toBeGreaterThan(scoreCompatibility(a, different));
  });

  it("rewards lyrical/thematic overlap when both sides have a fingerprint", () => {
    const fpA = fingerprintFromText("dancing all night under the neon lights of the city");
    const fpSimilar = fingerprintFromText("dancing under neon city lights all summer night long");
    const fpDifferent = fingerprintFromText("quiet rain falls softly on the empty winter mountain");
    const a = candidate("a", makeAnalysis(), fpA);
    const similar = candidate("similar", makeAnalysis(), fpSimilar);
    const different = candidate("different", makeAnalysis(), fpDifferent);
    expect(scoreCompatibility(a, similar)).toBeGreaterThan(scoreCompatibility(a, different));
  });

  it("treats a missing lyrical fingerprint on either side as no contribution, not a mismatch", () => {
    const a = candidate("a", makeAnalysis(), fingerprintFromText("some words here"));
    const bNoFingerprint = candidate("b", makeAnalysis());
    const cNoFingerprint = candidate("c", makeAnalysis());
    expect(scoreCompatibility(a, bNoFingerprint)).toBeCloseTo(scoreCompatibility(a, cNoFingerprint), 5);
  });

  it("scores 0 when either side has no analysis at all", () => {
    const a = candidate("a", makeAnalysis());
    const unanalyzed = candidate("b", null);
    expect(scoreCompatibility(a, unanalyzed)).toBe(0);
  });
});

describe("buildCompatibleOrder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps every candidate exactly once", () => {
    const candidates = [
      candidate("a", makeAnalysis({ bpm: 120 })),
      candidate("b", makeAnalysis({ bpm: 128 })),
      candidate("c", makeAnalysis({ bpm: 174 })),
    ];
    const ordered = buildCompatibleOrder(candidates);
    expect(ordered.map((c) => c.track.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("walks from the most compatible neighbor to the next, not array order", () => {
    // a (120 bpm) should reach for the 122-bpm neighbor before the 174-bpm one.
    const a = candidate("a", makeAnalysis({ bpm: 120, camelotKey: "8A" }));
    const far = candidate("far", makeAnalysis({ bpm: 174, camelotKey: "2B" }));
    const near = candidate("near", makeAnalysis({ bpm: 122, camelotKey: "8A" }));
    const ordered = buildCompatibleOrder([a, far, near]);
    expect(ordered[0].track.id).toBe("a");
    expect(ordered[1].track.id).toBe("near");
    expect(ordered[2].track.id).toBe("far");
  });

  it("starts from the given anchor instead of the first candidate", () => {
    const anchor = candidate("anchor", makeAnalysis({ bpm: 128 }));
    const near = candidate("near", makeAnalysis({ bpm: 129 }));
    const far = candidate("far", makeAnalysis({ bpm: 90 }));
    const ordered = buildCompatibleOrder([far, near], anchor);
    expect(ordered.map((c) => c.track.id)).toEqual(["near", "far"]);
  });

  it("breaks ties randomly rather than always by array order", () => {
    // No analysis at all anywhere — every pairing scores exactly 0, so the
    // walk is pure tiebreak. Force the "random" pick to the last candidate
    // each time and confirm that's actually respected (not silently
    // falling back to array order).
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const a = candidate("a", null);
    const b = candidate("b", null);
    const c = candidate("c", null);
    const ordered = buildCompatibleOrder([a, b, c]);
    expect(ordered.map((o) => o.track.id)).toEqual(["a", "c", "b"]);
  });
});
