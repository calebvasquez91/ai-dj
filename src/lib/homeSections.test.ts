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

describe("genre-aware Home rows", () => {
  const tag = (genre: string, source: "musicbrainz" | "lastfm" | "manual" = "musicbrainz", confidence = 0.85) => ({ genre, source, confidence, updatedAt: 1 });
  const song = (id: string, genre: string | null, over: Partial<Track> = {}): Track =>
    ({ id, title: id, artist: `artist-${id}`, durationSec: 100, addedAt: 0, source: "local", sourceUrl: id, ...(genre ? { genreTags: [tag(genre), tag(genre, "lastfm")] } : {}), ...over }) as Track;

  it("Mixed for you counts a shared genre, using the library's copy of what was played", () => {
    const library = [song("played", "Jazz"), song("jazz1", "Jazz"), song("jazz2", "Jazz"), song("rock1", "Rock")];
    // The played copy predates its classification: it carries no genre of its own.
    const history = [song("played", null)];
    expect(mixedForYou(library, history).map((t) => t.id)).toEqual(expect.arrayContaining(["jazz1", "jazz2"]));
    expect(mixedForYou(library, history).map((t) => t.id)).not.toContain("rock1");
  });
  it("a person's own genre decides what counts", () => {
    const manual = song("played", null, { genreTags: [tag("Jazz", "manual", 1), tag("Rock"), tag("Rock", "lastfm")] });
    const library = [manual, song("jazz1", "Jazz"), song("rock1", "Rock")];
    expect(mixedForYou(library, [manual]).map((t) => t.id)).toEqual(["jazz1"]);
  });
  it("quick picks put songs in the genres you played between what you played and what was added", () => {
    const library = [song("played", "Jazz", { addedAt: 1 }), song("new1", "Rock", { addedAt: 9 }), song("jazzy", "Jazz", { addedAt: 2 }), song("new2", "Rock", { addedAt: 8 })];
    const picks = quickPicks(library, [library[0]], 4).map((t) => t.id);
    expect(picks).toEqual(["played", "jazzy", "new1", "new2"]);
  });
  it("with no genre data, quick picks are just played then added, as before", () => {
    const library = [song("a", null, { addedAt: 1 }), song("b", null, { addedAt: 3 }), song("c", null, { addedAt: 2 })];
    expect(quickPicks(library, [library[0]], 3).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});
