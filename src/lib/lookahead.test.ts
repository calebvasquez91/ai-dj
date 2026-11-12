import { describe, expect, it } from "vitest";
import { ANALYSIS_LOOKAHEAD, LOOKUP_LOOKAHEAD, reachableTracks } from "./lookahead";
import { TRANSITION_TRACK_PREFIX } from "./transitionSound";

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

  it("leaves a transition sound's stand-in track out: it has no row on the server to look up", () => {
    const song = (id: string) => ({ id });
    const sound = { id: `${TRANSITION_TRACK_PREFIX}fx1:1` };
    // queued: skipped, and doesn't use up a place in the window
    expect(reachableTracks(song("a"), [sound, song("b"), song("c")], 2)).toEqual([song("a"), song("b"), song("c")]);
    // playing: counts as nothing playing, so the head of the queue is covered
    expect(reachableTracks(sound, [song("b"), song("c"), song("d")], 1)).toEqual([song("b"), song("c")]);
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
