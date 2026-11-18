import { describe, expect, it } from "vitest";
import { SMART_MAX_PLAYLISTS, SMART_MIN_GENRE_TRACKS, SMART_MIN_MOOD_TRACKS, smartPlaylists } from "@/lib/smartPlaylists";
import type { GenreTag, Track } from "@/types/music";

const tag = (genre: string, confidence = 0.8, source: GenreTag["source"] = "musicbrainz"): GenreTag => ({ genre, source, confidence, updatedAt: 1 });
let n = 0;
const make = (genre: string, over: Partial<Track> = {}): Track => {
  const id = over.id ?? `t${++n}`;
  return { id, title: id, artist: "a", durationSec: 200, addedAt: 0, source: "local", sourceUrl: `/api/tracks/${id}/audio`, genreTags: [tag(genre), tag(genre, 0.8, "lastfm")], genreStatus: "auto", ...over } as Track;
};
const many = (genre: string, count: number, over: Partial<Track> = {}) => Array.from({ length: count }, () => make(genre, over));

describe("smartPlaylists", () => {
  it("proposes a playlist for each genre with enough tracks, biggest first, marked smart", () => {
    const lib = [...many("Hip-Hop", 10), ...many("Rock", SMART_MIN_GENRE_TRACKS), ...many("Jazz", SMART_MIN_GENRE_TRACKS - 1)];
    const s = smartPlaylists(lib);
    expect(s.map((p) => p.title)).toEqual(["Hip-Hop", "Rock"]);
    expect(s.every((p) => p.smart)).toBe(true);
    expect(s[0].id).toBe("smart:Hip-Hop");
    expect(s[0].trackIds).toHaveLength(10);
  });
  it("adds a genre and mood playlist when the mood narrows the genre", () => {
    const lib = [...many("Hip-Hop", SMART_MIN_MOOD_TRACKS, { moods: ["late-night"] }), ...many("Hip-Hop", 5)];
    const s = smartPlaylists(lib);
    expect(s.map((p) => p.title)).toEqual(["Hip-Hop", "Late-night Hip-Hop"]);
    expect(s[1]).toMatchObject({ genre: "Hip-Hop", mood: "late-night", id: "smart:Hip-Hop:late-night" });
    expect(s[1].trackIds).toHaveLength(SMART_MIN_MOOD_TRACKS);
  });
  it("does not repeat a genre playlist as a mood playlist when every track has the mood", () => {
    const lib = many("Jazz", 9, { moods: ["chill"] });
    expect(smartPlaylists(lib).map((p) => p.title)).toEqual(["Jazz"]);
  });
  it("leaves out Do-Not-Play tracks and Halloween music", () => {
    const lib = [...many("Rock", 7), make("Rock", { playPreference: "do-not" }), make("Rock", { tags: ["halloween"] })];
    expect(smartPlaylists(lib)).toEqual([]);
    expect(smartPlaylists([...lib, make("Rock")])[0].trackIds).toHaveLength(8);
  });
  it("puts the surest tracks of a genre first", () => {
    const lib = [...many("Rock", 8), make("Rock", { id: "sure", genreTags: [tag("Rock", 0.95), tag("Rock", 0.95, "lastfm")] })];
    expect(smartPlaylists(lib)[0].trackIds[0]).toBe("sure");
  });
  it("counts a track with two genres in both, and ignores unclassified tracks", () => {
    const both = Array.from({ length: 8 }, () => make("Pop", { genreTags: [tag("Pop"), tag("Pop", 0.8, "lastfm"), tag("Rock"), tag("Rock", 0.8, "lastfm")] }));
    const s = smartPlaylists([...both, ...Array.from({ length: 20 }, () => ({ id: `u${++n}`, title: "u", artist: "a", durationSec: 1, addedAt: 0, source: "local", sourceUrl: "x" }) as Track)]);
    expect(s.map((p) => p.title).sort()).toEqual(["Pop", "Rock"]);
  });
  it("caps how many it proposes, and refreshes as tracks are added", () => {
    const genres = ["Rock", "Pop", "Jazz", "Blues", "Folk", "Soul", "Funk", "Metal", "Punk", "Disco", "Latin", "Country", "World", "Gospel"];
    expect(smartPlaylists(genres.flatMap((g) => many(g, 8))).length).toBe(SMART_MAX_PLAYLISTS);
    const before = smartPlaylists(many("Rock", 7));
    const after = smartPlaylists(many("Rock", 8));
    expect(before).toEqual([]);
    expect(after).toHaveLength(1);
  });
  it("is empty for an empty library", () => {
    expect(smartPlaylists([])).toEqual([]);
  });
});
