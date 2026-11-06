import { describe, expect, it } from "vitest";
import type { Playlist, Track } from "@/types/music";
import { HOME_CHIPS, chipView, mixedForYou, pinnedFirst, quickPicks, recentlyAdded, recentlyPlayed } from "./homeSections";

function track(id: string, extra: Partial<Track> = {}): Track {
  return { id, title: id, artist: `artist-${id}`, source: "local", sourceUrl: `/t/${id}`, durationSec: 200, addedAt: 0, ...extra } as Track;
}
const ids = (tracks: Track[]) => tracks.map((t) => t.id);

describe("recentlyPlayed", () => {
  it("is newest first with each song once", () => {
    expect(ids(recentlyPlayed([track("a"), track("b"), track("a"), track("c")], 10))).toEqual(["c", "a", "b"]);
  });

  it("respects the limit and handles no history", () => {
    expect(ids(recentlyPlayed([track("a"), track("b"), track("c")], 2))).toEqual(["c", "b"]);
    expect(recentlyPlayed([], 5)).toEqual([]);
  });
});

describe("recentlyAdded", () => {
  it("is newest first and does not reorder the library", () => {
    const library = [track("old", { addedAt: 1 }), track("new", { addedAt: 9 }), track("mid", { addedAt: 5 })];
    expect(ids(recentlyAdded(library, 2))).toEqual(["new", "mid"]);
    expect(ids(library)).toEqual(["old", "new", "mid"]);
  });
});

describe("quickPicks", () => {
  it("offers what was played, then what was added, with no repeats", () => {
    const library = [track("a", { addedAt: 1 }), track("b", { addedAt: 2 }), track("c", { addedAt: 3 })];
    expect(ids(quickPicks(library, [track("a")], 10))).toEqual(["a", "c", "b"]);
  });

  it("holds at most 27 by default (three pages of nine)", () => {
    const library = Array.from({ length: 40 }, (_, i) => track(`t${i}`, { addedAt: i }));
    expect(quickPicks(library, [])).toHaveLength(27);
  });
});

describe("mixedForYou", () => {
  const library = [
    track("heard", { artist: "Daft Punk" }),
    track("same-artist", { artist: "Daft Punk", tags: ["dance"], addedAt: 1 }),
    track("same-tag", { artist: "Other", tags: ["Dance"], addedAt: 2 }),
    track("unrelated", { artist: "Nobody" }),
    track("skip", { artist: "Daft Punk", playPreference: "do-not" }),
  ];
  const history = [track("heard", { artist: "Daft Punk", tags: ["dance"] })];

  it("offers songs by the same artist or with the same tags, best match first", () => {
    // same-artist matches on the artist and the tag (2 points), same-tag on the tag alone (1)
    expect(ids(mixedForYou(library, history))).toEqual(["same-artist", "same-tag"]);
  });

  it("never offers back what was just played, or a Do-Not-Play song", () => {
    const out = ids(mixedForYou(library, history));
    expect(out).not.toContain("heard");
    expect(out).not.toContain("skip");
    expect(out).not.toContain("unrelated");
  });

  it("is empty with nothing played", () => {
    expect(mixedForYou(library, [])).toEqual([]);
  });
});

describe("chipView", () => {
  it("All shows everything, Music only songs, Mixes only mixes", () => {
    expect(chipView("all")).toEqual({ showMixes: true, showMusic: true, mood: null });
    expect(chipView("music")).toEqual({ showMixes: false, showMusic: true, mood: null });
    expect(chipView("mixes")).toEqual({ showMixes: true, showMusic: false, mood: null });
  });

  it("a mood keeps both and carries the mood", () => {
    expect(chipView("chill")).toEqual({ showMixes: true, showMusic: true, mood: "chill" });
  });

  it("has the seven chips of the spec, in order", () => {
    expect(HOME_CHIPS.map((c) => c.label)).toEqual(["All", "Music", "Mixes", "Energize", "Chill", "Workout", "Party"]);
  });
});

describe("pinnedFirst", () => {
  const pl = (id: string, createdAt: number, theme?: string): Playlist => ({ id, name: id, tracks: [], createdAt, theme });

  it("puts Spooky Music first and the rest newest first", () => {
    expect(pinnedFirst([pl("old", 1), pl("spooky", 0, "spooky"), pl("new", 9)]).map((p) => p.id)).toEqual(["spooky", "new", "old"]);
  });

  it("does not reorder what it was given", () => {
    const input = [pl("a", 1), pl("b", 2)];
    pinnedFirst(input);
    expect(input.map((p) => p.id)).toEqual(["a", "b"]);
  });
});
