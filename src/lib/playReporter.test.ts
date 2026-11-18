import { describe, expect, it } from "vitest";
import { createPlayAccumulator } from "./playReporter";

const song = { trackId: "t1", playlistId: "p1" };

describe("createPlayAccumulator", () => {
  it("credits the time between looks to what is playing", () => {
    const acc = createPlayAccumulator();
    acc.tick(0, song);
    acc.tick(1000, song);
    acc.tick(2000, song);
    expect(acc.drain()).toEqual([{ trackId: "t1", playlistId: "p1", seconds: 2 }]);
  });

  it("credits nothing while paused, and nothing for the first look", () => {
    const acc = createPlayAccumulator();
    acc.tick(0, song); // the first look has nothing before it
    acc.tick(1000, null);
    acc.tick(2000, null);
    expect(acc.drain()).toEqual([]);
  });

  it("keeps songs, and the same song in different playlists, apart", () => {
    const acc = createPlayAccumulator();
    acc.tick(0, null);
    acc.tick(1000, song);
    acc.tick(2000, { trackId: "t1", playlistId: null });
    acc.tick(3000, { trackId: "t2", playlistId: "p1" });
    const out = acc.drain();
    expect(out).toHaveLength(3);
    expect(out.every((s) => s.seconds === 1)).toBe(true);
  });

  it("caps what one look may credit, so sleep or a frozen tab does not count as listening", () => {
    const acc = createPlayAccumulator(5000);
    acc.tick(0, song);
    acc.tick(60 * 60 * 1000, song); // an hour later
    expect(acc.drain()).toEqual([{ trackId: "t1", playlistId: "p1", seconds: 5 }]);
  });

  it("drops segments under a second and resets after draining", () => {
    const acc = createPlayAccumulator();
    acc.tick(0, song);
    acc.tick(400, song);
    expect(acc.drain()).toEqual([]);
    acc.tick(1400, song);
    expect(acc.drain()).toEqual([{ trackId: "t1", playlistId: "p1", seconds: 1 }]);
    expect(acc.drain()).toEqual([]);
  });
});
