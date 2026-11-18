import { describe, expect, it } from "vitest";
import { createPlayAccumulator } from "./playReporter";

const at = (positionSec: number, over: Partial<{ trackId: string; playlistId: string | null }> = {}) => ({
  trackId: "t1",
  playlistId: "p1" as string | null,
  positionSec,
  ...over,
});

describe("createPlayAccumulator", () => {
  it("credits how far the playback position moved", () => {
    const acc = createPlayAccumulator();
    acc.observe(0, at(10));
    acc.observe(1000, at(11));
    acc.observe(2000, at(12));
    expect(acc.drain()).toEqual([{ trackId: "t1", playlistId: "p1", seconds: 2 }]);
  });

  it("still counts real playing when the page looked rarely (a locked phone, a background tab)", () => {
    const acc = createPlayAccumulator();
    acc.observe(0, at(10));
    // Nothing looked for two minutes; the position shows two minutes of the song really played.
    acc.observe(120_000, at(130));
    expect(acc.drain()).toEqual([{ trackId: "t1", playlistId: "p1", seconds: 120 }]);
  });

  it("counts nothing for time that passed while the position did not move (paused, stalled, asleep)", () => {
    const acc = createPlayAccumulator();
    acc.observe(0, at(10));
    acc.observe(60 * 60 * 1000, at(10)); // an hour later, same place
    expect(acc.drain()).toEqual([]);
  });

  it("does not count a seek as listening: credit is capped by the clock time that really passed", () => {
    const acc = createPlayAccumulator();
    acc.observe(0, at(10));
    acc.observe(250, at(130)); // jumped two minutes ahead in a quarter of a second
    expect(acc.drain()).toEqual([]); // the capped credit is under a second
    acc.observe(1250, at(131));
    expect(acc.drain()).toEqual([{ trackId: "t1", playlistId: "p1", seconds: 1 }]);
  });

  it("counts nothing for going back, or for the first look, or while nothing is playing", () => {
    const acc = createPlayAccumulator();
    acc.observe(0, at(50));
    acc.observe(1000, at(5)); // restarted
    acc.observe(2000, null); // paused
    acc.observe(3000, at(5)); // resumed: the gap while paused is not credited
    expect(acc.drain()).toEqual([]);
  });

  it("keeps songs, and the same song in different playlists, apart, and starts afresh on a change", () => {
    const acc = createPlayAccumulator();
    acc.observe(0, at(0));
    acc.observe(1000, at(1));
    acc.observe(2000, at(0, { trackId: "t2" })); // a different song: nothing credited for the switch
    acc.observe(3000, at(1, { trackId: "t2" }));
    acc.observe(4000, at(1, { trackId: "t2", playlistId: null })); // same song, now outside a playlist
    acc.observe(5000, at(2, { trackId: "t2", playlistId: null }));
    const out = acc.drain().sort((a, b) => a.trackId.localeCompare(b.trackId));
    expect(out).toEqual([
      { trackId: "t1", playlistId: "p1", seconds: 1 },
      { trackId: "t2", playlistId: "p1", seconds: 1 },
      { trackId: "t2", playlistId: null, seconds: 1 },
    ]);
  });

  it("reports what is pending, drops segments under a second, and resets after draining", () => {
    const acc = createPlayAccumulator();
    acc.observe(0, at(0));
    acc.observe(400, at(0.4));
    expect(acc.pendingSeconds()).toBeCloseTo(0.4);
    expect(acc.drain()).toEqual([]);
    expect(acc.pendingSeconds()).toBe(0);
    acc.observe(1400, at(1.4));
    expect(acc.drain()).toEqual([{ trackId: "t1", playlistId: "p1", seconds: 1 }]);
  });
});
