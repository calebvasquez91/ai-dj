import { describe, expect, it, vi, afterEach } from "vitest";
import { shuffleForPlay, dropTheNeedle } from "./shuffle";
import type { Track } from "@/types/music";

function makeTrack(id: string, playPreference?: Track["playPreference"]): Track {
  return {
    id,
    title: id,
    artist: "Test Artist",
    durationSec: 200,
    addedAt: 0,
    source: "local",
    sourceUrl: `blob:${id}`,
    playPreference,
  };
}

describe("shuffleForPlay", () => {
  it("excludes do-not-play tracks entirely", () => {
    const tracks = [makeTrack("a"), makeTrack("b", "do-not"), makeTrack("c")];
    const result = shuffleForPlay(tracks);
    expect(result.some((t) => t.id === "b")).toBe(false);
    expect(result).toHaveLength(2);
  });

  it("puts must-play tracks first", () => {
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c", "must"), makeTrack("d")];
    const result = shuffleForPlay(tracks);
    expect(result[0].id).toBe("c");
  });

  it("keeps all non-do-not tracks when there is no must-play track", () => {
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    const result = shuffleForPlay(tracks);
    expect(result.map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array when everything is excluded", () => {
    const tracks = [makeTrack("a", "do-not"), makeTrack("b", "do-not")];
    expect(shuffleForPlay(tracks)).toEqual([]);
  });
});

describe("dropTheNeedle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("excludes do-not-play tracks entirely", () => {
    const tracks = [makeTrack("a"), makeTrack("b", "do-not"), makeTrack("c")];
    const result = dropTheNeedle(tracks);
    expect(result.some((t) => t.id === "b")).toBe(false);
    expect(result).toHaveLength(2);
  });

  it("puts must-play tracks first", () => {
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c", "must"), makeTrack("d")];
    const result = dropTheNeedle(tracks);
    expect(result[0].id).toBe("c");
  });

  it("returns every eligible track exactly once, in some order", () => {
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c"), makeTrack("d")];
    const result = dropTheNeedle(tracks);
    expect(result.map((t) => t.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("is genuinely random, not a fixed order", () => {
    const tracks = Array.from({ length: 10 }, (_, i) => makeTrack(`t${i}`));
    // A real Math.random() run could theoretically reproduce the original
    // order, but the odds across 10! permutations are astronomically low —
    // this is a practical randomness smoke test, not a proof.
    const first = dropTheNeedle(tracks).map((t) => t.id);
    const second = dropTheNeedle(tracks).map((t) => t.id);
    expect(first).not.toEqual(second);
  });

  it("returns an empty array when everything is excluded", () => {
    const tracks = [makeTrack("a", "do-not"), makeTrack("b", "do-not")];
    expect(dropTheNeedle(tracks)).toEqual([]);
  });
});
