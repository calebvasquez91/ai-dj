import { describe, expect, it } from "vitest";
import { buildInitialShuffleBatch, buildShuffleSessionPool, extendShuffleQueue, SHUFFLE_INITIAL_COUNT } from "./shuffle";
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

describe("buildShuffleSessionPool", () => {
  it("excludes do-not-play tracks entirely", () => {
    const tracks = [makeTrack("a"), makeTrack("b", "do-not"), makeTrack("c")];
    const pool = buildShuffleSessionPool(tracks);
    expect(pool.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("keeps everything else, must-play included", () => {
    const tracks = [makeTrack("a"), makeTrack("b", "must")];
    expect(buildShuffleSessionPool(tracks)).toHaveLength(2);
  });
});

describe("buildInitialShuffleBatch", () => {
  it("puts must-play tracks first", () => {
    const pool = [makeTrack("a"), makeTrack("b"), makeTrack("c", "must"), makeTrack("d")];
    const batch = buildInitialShuffleBatch(pool, {}, {});
    expect(batch[0].id).toBe("c");
  });

  it("caps at SHUFFLE_INITIAL_COUNT for a large pool", () => {
    const pool = Array.from({ length: 30 }, (_, i) => makeTrack(`t${i}`));
    const batch = buildInitialShuffleBatch(pool, {}, {});
    expect(batch).toHaveLength(SHUFFLE_INITIAL_COUNT);
  });

  it("returns the whole pool when it's smaller than SHUFFLE_INITIAL_COUNT", () => {
    const pool = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    const batch = buildInitialShuffleBatch(pool, {}, {});
    expect(batch.map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("grows the batch past SHUFFLE_INITIAL_COUNT when there are more must-play tracks than that, without padding beyond them", () => {
    const must = Array.from({ length: 12 }, (_, i) => makeTrack(`must${i}`, "must"));
    const pool = [...must, makeTrack("rest")];
    const batch = buildInitialShuffleBatch(pool, {}, {});
    expect(batch).toHaveLength(12);
    expect(batch.every((t) => t.playPreference === "must")).toBe(true);
  });

  it("returns an empty batch for an empty pool", () => {
    expect(buildInitialShuffleBatch([], {}, {})).toEqual([]);
  });

  it("deprioritizes the previous session's opening track for the new opening pick", () => {
    const pool = Array.from({ length: 20 }, (_, i) => makeTrack(`t${i}`));
    let openingCounts = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      const batch = buildInitialShuffleBatch(pool, {}, {}, ["t0"]);
      if (batch[0].id === "t0") openingCounts++;
    }
    // Uniform random over 20 tracks would pick t0 first ~10 times in 200
    // trials; the deprioritize penalty should push it well below that.
    expect(openingCounts).toBeLessThan(10);
  });
});

describe("extendShuffleQueue", () => {
  it("returns SHUFFLE_EXTEND_COUNT tracks when the pool comfortably supports it", () => {
    const pool = Array.from({ length: 20 }, (_, i) => makeTrack(`t${i}`));
    const session = { pool, unplayedIds: pool.slice(5).map((t) => t.id) };
    const { batch } = extendShuffleQueue(session, pool[0], new Set(), {}, {});
    expect(batch).toHaveLength(5);
    expect(new Set(batch.map((t) => t.id)).size).toBe(5); // no duplicates within the batch
  });

  it("laps (refills from the pool) without picking a protected id when unplayedIds runs out", () => {
    const pool = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    const session = { pool, unplayedIds: ["a"] }; // only 1 unplayed left, need 5
    const protectIds = new Set(["b"]); // "b" is still live in the queue
    const { batch } = extendShuffleQueue(session, pool[0], protectIds, {}, {});
    expect(batch.some((t) => t.id === "b")).toBe(false);
    expect(batch.length).toBeGreaterThan(0);
  });

  it("degrades to a partial batch without throwing when the whole pool is protected", () => {
    const pool = [makeTrack("a"), makeTrack("b")];
    const session = { pool, unplayedIds: [] };
    const protectIds = new Set(["a", "b"]);
    const { batch } = extendShuffleQueue(session, pool[0], protectIds, {}, {});
    expect(batch).toEqual([]);
  });

  it("returns updated unplayedIds excluding what was just picked", () => {
    const pool = Array.from({ length: 8 }, (_, i) => makeTrack(`t${i}`));
    const session = { pool, unplayedIds: pool.map((t) => t.id) };
    const { batch, unplayedIds } = extendShuffleQueue(session, pool[0], new Set(), {}, {});
    for (const t of batch) {
      expect(unplayedIds).not.toContain(t.id);
    }
  });
});
