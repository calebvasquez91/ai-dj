import { describe, expect, it } from "vitest";
import type { TrackAnalysis } from "@/lib/audio-analysis-core";
import type { Track } from "@/types/music";
import { buildMixes, meanPeak, moodsFor, trackFeel, tracksForMood } from "./moods";

function track(id: string, extra: Partial<Track> = {}): Track {
  return { id, title: id, artist: "A", source: "local", sourceUrl: `/t/${id}`, durationSec: 200, addedAt: 0, ...extra } as Track;
}
function analysis(bpm: number, level: number, fallback = false): TrackAnalysis {
  return { bpm, waveformPeaks: [level, level], fallback } as unknown as TrackAnalysis;
}

describe("meanPeak", () => {
  it("averages the peaks, and is null for none", () => {
    expect(meanPeak([0.2, 0.4])).toBeCloseTo(0.3);
    expect(meanPeak([])).toBeNull();
    expect(meanPeak(undefined)).toBeNull();
  });
});

describe("trackFeel", () => {
  it("reads tempo and loudness from a real analysis", () => {
    expect(trackFeel(track("a"), analysis(128, 0.5))).toEqual({ bpm: 128, energy: 0.5 });
  });

  it("does not trust an analysis that fell back to the default", () => {
    expect(trackFeel(track("a", { bpm: 90 } as Partial<Track>), analysis(120, 0.9, true))).toEqual({ bpm: 90, energy: null });
  });

  it("falls back to the local track's own BPM, and has none for a YouTube track", () => {
    expect(trackFeel(track("a", { bpm: 100 } as Partial<Track>), undefined)).toEqual({ bpm: 100, energy: null });
    expect(trackFeel({ ...track("y"), source: "youtube", youtubeVideoId: "v" } as Track, undefined)).toEqual({ bpm: null, energy: null });
  });
});

describe("moodsFor", () => {
  it("calls slow and quiet Chill", () => {
    expect(moodsFor(track("a"), { bpm: 85, energy: 0.2 })).toEqual(["chill"]);
  });

  it("does not call slow but loud Chill", () => {
    expect(moodsFor(track("a"), { bpm: 90, energy: 0.8 })).not.toContain("chill");
  });

  it("puts a fast, loud track in Energize, Workout and Party where it fits", () => {
    expect(moodsFor(track("a"), { bpm: 128, energy: 0.7 })).toEqual(["energize", "workout", "party"]);
  });

  it("keeps Workout to its tempo band", () => {
    expect(moodsFor(track("a"), { bpm: 175, energy: 0.7 })).not.toContain("workout");
    expect(moodsFor(track("a"), { bpm: 119, energy: 0.7 })).not.toContain("workout");
  });

  it("uses tags whatever the tempo, case and spacing aside", () => {
    expect(moodsFor(track("a", { tags: [" Chill ", "GYM"] }), { bpm: null, energy: null })).toEqual(["chill", "workout"]);
  });

  it("knows nothing about a track with neither tags nor tempo", () => {
    expect(moodsFor(track("a"), { bpm: null, energy: null })).toEqual([]);
  });
});

describe("buildMixes", () => {
  const library = [
    track("slow1"),
    track("slow2"),
    track("slow3"),
    track("fast1"),
    track("fast2"),
    track("fast3"),
    track("skipped", { playPreference: "do-not" }),
  ];
  const analyses: Record<string, TrackAnalysis> = {
    slow1: analysis(80, 0.2),
    slow2: analysis(90, 0.2),
    slow3: analysis(70, 0.3),
    fast1: analysis(150, 0.8),
    fast2: analysis(140, 0.8),
    fast3: analysis(160, 0.8),
    skipped: analysis(85, 0.1),
  };

  it("makes a mix per mood that has enough songs, in the order of the moods", () => {
    expect(buildMixes(library, analyses).map((m) => m.mood)).toEqual(["energize", "chill", "workout"]);
  });

  it("orders each mix slow to fast and leaves out Do-Not-Play songs", () => {
    const chill = buildMixes(library, analyses).find((m) => m.mood === "chill")!;
    expect(chill.tracks.map((t) => t.id)).toEqual(["slow3", "slow1", "slow2"]);
  });

  it("makes no mix for a mood with fewer songs than the minimum", () => {
    expect(buildMixes(library, analyses, 4).map((m) => m.mood)).not.toContain("chill");
    expect(buildMixes([], {})).toEqual([]);
  });
});

describe("tracksForMood", () => {
  it("keeps library order", () => {
    const a = track("a", { tags: ["party"] });
    const b = track("b");
    const c = track("c", { tags: ["party"] });
    expect(tracksForMood([a, b, c], {}, "party").map((t) => t.id)).toEqual(["a", "c"]);
  });
});
