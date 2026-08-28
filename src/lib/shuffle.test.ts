import { describe, expect, it } from "vitest";
import { dropTheNeedle, shuffleForPlay } from "./shuffle";
import type { Track } from "@/types/music";

function makeTrack(id: string, playPreference?: Track["playPreference"]): Track {
  return { id, title: id, artist: "Test Artist", durationSec: 200, addedAt: 0, sourceUrl: `blob:${id}`, playPreference };
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

  it("keeps every non-excluded track exactly once, in some order", () => {
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c"), makeTrack("d"), makeTrack("e")];
    const result = dropTheNeedle(tracks);
    expect(result.map((t) => t.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("is not merely the identity order — actually shuffles across repeated calls", () => {
    const tracks = Array.from({ length: 12 }, (_, i) => makeTrack(String(i)));
    const orders = new Set(Array.from({ length: 20 }, () => dropTheNeedle(tracks).map((t) => t.id).join(",")));
    // With 12! possible orderings, seeing more than one distinct result
    // across 20 runs is as close to certain as a randomness test gets.
    expect(orders.size).toBeGreaterThan(1);
  });
});
