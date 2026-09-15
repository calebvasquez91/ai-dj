import { describe, expect, it } from "vitest";
import { computeAutoHotCues, mergeHotCues, resolveHotCues, upcomingDropCueAtSec } from "./hot-cues";
import type { TrackAnalysis } from "./audio-analysis";
import type { Track } from "@/types/music";

function makeLocalTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "t1",
    title: "Song",
    artist: "Artist",
    durationSec: 300,
    addedAt: 0,
    source: "local",
    sourceUrl: "blob:t1",
    ...overrides,
  } as Track;
}

function makeYoutubeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "y1",
    title: "Video",
    artist: "Channel",
    durationSec: 300,
    addedAt: 0,
    source: "youtube",
    youtubeVideoId: "abc123",
    ...overrides,
  } as Track;
}

function makeAnalysis(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return {
    bpm: 120, // exactly 2s/bar, so bar math is easy to check by hand
    bpmConfidence: 0.8,
    beatGridOffsetSec: 1,
    energyOnsetSec: 1,
    key: null,
    keyConfidence: 0,
    camelotKey: null,
    breakdownAtSec: null,
    dropAtSec: null,
    buildDropPairs: [],
    waveformPeaks: [],
    fallback: false,
    ...overrides,
  };
}

describe("computeAutoHotCues", () => {
  it("places Cue 1 at the beat grid offset and Cue 2 8 bars later", () => {
    const cues = computeAutoHotCues(makeAnalysis(), 300);
    expect(cues[0]).toBe(1); // beatGridOffsetSec
    expect(cues[1]).toBeCloseTo(1 + 8 * 2, 5); // 8 bars * 2s/bar at 120bpm
  });

  it("places Cues 7/8 16 and 8 bars before the end, for a track with room for an outro", () => {
    const durationSec = 300;
    const cues = computeAutoHotCues(makeAnalysis(), durationSec);
    expect(cues[6]).toBeCloseTo(durationSec - 16 * 2, 5);
    expect(cues[7]).toBeCloseTo(durationSec - 8 * 2, 5);
    expect(cues[7]! - cues[6]!).toBeCloseTo(8 * 2, 5); // Cue 8 is exactly 8 bars after Cue 7
  });

  it("leaves Cues 7/8 unset for a track too short for a 16-bar outro lookback to mean anything", () => {
    const cues = computeAutoHotCues(makeAnalysis(), 20); // way under 32 bars (64s) at 120bpm
    expect(cues[6]).toBeNull();
    expect(cues[7]).toBeNull();
  });

  it("places Cues 3/4 from the first build/drop pair and leaves 5/6 unset with only one pair", () => {
    const analysis = makeAnalysis({ buildDropPairs: [{ buildAtSec: 40, dropAtSec: 48 }] });
    const cues = computeAutoHotCues(analysis, 300);
    expect(cues[2]).not.toBeNull();
    expect(cues[3]).not.toBeNull();
    expect(cues[4]).toBeNull();
    expect(cues[5]).toBeNull();
  });

  it("places all of Cues 3-6 given two build/drop pairs", () => {
    const analysis = makeAnalysis({
      buildDropPairs: [
        { buildAtSec: 40, dropAtSec: 48 },
        { buildAtSec: 180, dropAtSec: 188 },
      ],
    });
    const cues = computeAutoHotCues(analysis, 300);
    expect(cues[2]).not.toBeNull();
    expect(cues[3]).not.toBeNull();
    expect(cues[4]).not.toBeNull();
    expect(cues[5]).not.toBeNull();
  });

  it("leaves Cues 3-6 unset when the detector found no build/drop pairs at all", () => {
    const cues = computeAutoHotCues(makeAnalysis({ buildDropPairs: [] }), 300);
    expect(cues.slice(2, 6)).toEqual([null, null, null, null]);
  });

  it("returns all-null for a track with no usable BPM", () => {
    const cues = computeAutoHotCues(makeAnalysis({ bpm: 0 }), 300);
    expect(cues).toEqual(new Array(8).fill(null));
  });
});

describe("mergeHotCues", () => {
  it("uses the auto value when there's no override", () => {
    const auto = [10, null, null, null, null, null, null, null];
    const merged = mergeHotCues(auto, undefined);
    expect(merged[0]).toEqual({ atSec: 10, source: "auto" });
    expect(merged[1]).toEqual({ atSec: null, source: null });
  });

  it("prefers a manual override over an auto placement", () => {
    const auto = [10, null, null, null, null, null, null, null];
    const merged = mergeHotCues(auto, { 1: 99 });
    expect(merged[0]).toEqual({ atSec: 99, source: "manual" });
  });

  it("fills a gap the detector left empty with a manual override", () => {
    const auto = new Array(8).fill(null);
    const merged = mergeHotCues(auto, { 4: 55.5 });
    expect(merged[3]).toEqual({ atSec: 55.5, source: "manual" });
    expect(merged[0]).toEqual({ atSec: null, source: null });
  });
});

describe("resolveHotCues", () => {
  it("auto-places cues for a local track from its analysis, with a manual override winning", () => {
    const track = makeLocalTrack({ hotCueOverrides: { 1: 5 } });
    const slots = resolveHotCues(track, makeAnalysis());
    expect(slots[0]).toEqual({ atSec: 5, source: "manual" });
    expect(slots[1].source).toBe("auto");
  });

  it("never auto-places cues for a YouTube track, even given a usable-looking analysis", () => {
    const track = makeYoutubeTrack({ hotCueOverrides: { 1: 3 } });
    const slots = resolveHotCues(track, makeAnalysis());
    expect(slots[0]).toEqual({ atSec: 3, source: "manual" });
    expect(slots.slice(1).every((s) => s.atSec === null)).toBe(true);
  });

  it("returns all-null for a local track with no analysis yet and no overrides", () => {
    const slots = resolveHotCues(makeLocalTrack(), undefined);
    expect(slots.every((s) => s.atSec === null)).toBe(true);
  });
});

describe("upcomingDropCueAtSec", () => {
  const slots = mergeHotCues([null, null, null, 40, null, 158, null, null], undefined);

  it("returns Cue 4 (Drop 1) when it's still ahead of the given time", () => {
    expect(upcomingDropCueAtSec(slots, 10)).toBe(40);
  });

  it("returns Cue 6 (Drop 2) once Cue 4 has already passed", () => {
    expect(upcomingDropCueAtSec(slots, 50)).toBe(158);
  });

  it("returns null once both drop cues have passed", () => {
    expect(upcomingDropCueAtSec(slots, 200)).toBeNull();
  });

  it("returns null when neither drop cue is placed", () => {
    expect(upcomingDropCueAtSec(mergeHotCues(new Array(8).fill(null), undefined), 0)).toBeNull();
  });
});
