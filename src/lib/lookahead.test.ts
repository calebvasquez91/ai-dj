import { describe, expect, it } from "vitest";
import { ANALYSIS_LOOKAHEAD, LOOKUP_LOOKAHEAD, reachableTracks } from "./lookahead";

const queue = Array.from({ length: 2442 }, (_, i) => `t${i}`);

describe("reachableTracks", () => {
  it("is the playing track plus the next `ahead` queued tracks", () => {
    expect(reachableTracks("now", ["a", "b", "c", "d", "e"], 3)).toEqual(["now", "a", "b", "c"]);
  });

  it("never walks a huge queue", () => {
    expect(reachableTracks("now", queue, LOOKUP_LOOKAHEAD)).toHaveLength(LOOKUP_LOOKAHEAD + 1);
    expect(reachableTracks("now", queue, ANALYSIS_LOOKAHEAD)).toHaveLength(ANALYSIS_LOOKAHEAD + 1);
  });

  it("with nothing playing, covers the head of the queue (the same number of tracks)", () => {
    expect(reachableTracks(null, ["a", "b", "c", "d", "e"], 3)).toEqual(["a", "b", "c", "d"]);
    expect(reachableTracks(undefined, queue, 2)).toEqual(["t0", "t1", "t2"]);
  });

  it("handles a short or empty queue and a zero or odd lookahead", () => {
    expect(reachableTracks("now", [], 5)).toEqual(["now"]);
    expect(reachableTracks(null, [], 5)).toEqual([]);
    expect(reachableTracks("now", ["a", "b"], 0)).toEqual(["now"]);
    expect(reachableTracks("now", ["a", "b"], -4)).toEqual(["now"]);
    expect(reachableTracks("now", ["a", "b", "c"], 1.9)).toEqual(["now", "a"]);
  });

  it("keeps the queue order, so the nearest upcoming track is always first in line", () => {
    const window = reachableTracks("now", queue, 4);
    expect(window.slice(1)).toEqual(["t0", "t1", "t2", "t3"]);
  });

  it("does not mutate the queue", () => {
    const q = ["a", "b", "c"];
    reachableTracks("now", q, 2);
    expect(q).toEqual(["a", "b", "c"]);
  });
});
