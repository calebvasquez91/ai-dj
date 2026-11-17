import { describe, expect, it } from "vitest";
import { genreHits, genreMatchScore, interpretGenreQuery, mergeHits } from "@/lib/genreSearch";
import { searchAll, searchTracks, searchTracksWithGenres } from "@/lib/search";
import type { GenreTag, Track } from "@/types/music";

const tag = (genre: string, subgenre?: string, confidence = 0.85, source: GenreTag["source"] = "musicbrainz"): GenreTag => ({ genre, ...(subgenre ? { subgenre } : {}), source, confidence, updatedAt: 1 });
let n = 0;
const make = (title: string, genres: GenreTag[] = [], over: Partial<Track> = {}): Track => {
  const id = `t${++n}`;
  return { id, title, artist: "Artist", durationSec: 200, addedAt: 0, source: "local", sourceUrl: `/api/tracks/${id}/audio`, genreTags: genres, genreStatus: "auto", ...over } as Track;
};
const both = (genre: string, subgenre?: string) => [tag(genre, subgenre), tag(genre, subgenre, 0.8, "lastfm")];

const library = [
  make("Mask Off", both("Hip-Hop", "Trap")),
  make("Real Rap", both("Hip-Hop")),
  make("Slow Burn", both("R&B", "Slow Jams"), { year: 1996 }),
  make("Old School Jam", both("R&B"), { year: 1994 }),
  make("New R&B", both("R&B"), { year: 2019 }),
  make("Unknown Year R&B", both("R&B")),
  make("Deep Cut", both("Electronic", "Deep House"), { moods: ["chill"] }),
  make("Rock Anthem", both("Rock")),
  make("Trapped in a Dream", both("Rock")),
  make("Unclassified"),
];
const titles = (hits: { item: Track }[]) => hits.map((h) => h.item.title);

describe("understanding a query's genre words", () => {
  it("reads genres, subgenres, moods and decades, and nothing else", () => {
    expect(interpretGenreQuery("trap")?.subgenres).toContain("Trap");
    expect(interpretGenreQuery("slow jams")?.subgenres).toContain("Slow Jams");
    expect(interpretGenreQuery("90s r&b")).toMatchObject({ genres: ["R&B"], eraRange: { from: 1990, to: 1999 } });
    expect(interpretGenreQuery("rap")?.genres).toEqual(["Hip-Hop"]);
    expect(interpretGenreQuery("chill")?.moods).toEqual(["chill"]);
    expect(interpretGenreQuery("some words that say nothing")).toBeNull();
    expect(interpretGenreQuery("   ")).toBeNull();
    expect(interpretGenreQuery("")).toBeNull();
  });
});

describe("matching a track to those words", () => {
  const spec = interpretGenreQuery("90s r&b")!;
  it("needs the genre, and a known year inside the decade; an unknown year ranks lower but stays", () => {
    expect(genreMatchScore(library[2], spec)).not.toBeNull();
    expect(genreMatchScore(library[4], spec)).toBeNull();
    expect(genreMatchScore(library[0], spec)).toBeNull();
    const unknown = genreMatchScore(library[5], spec)!;
    expect(unknown).toBeGreaterThan(0);
    expect(unknown).toBeLessThan(genreMatchScore(library[2], spec)!);
  });
  it("a subgenre query wants the subgenre, not its parent genre alone", () => {
    const trap = interpretGenreQuery("trap")!;
    expect(genreMatchScore(library[0], trap)).not.toBeNull();
    expect(genreMatchScore(library[1], trap)).toBeNull();
  });
  it("a mood query wants a track with that mood", () => {
    const chill = interpretGenreQuery("chill")!;
    expect(genreMatchScore(library[6], chill)).not.toBeNull();
    expect(genreMatchScore(library[7], chill)).toBeNull();
  });
});

describe("searching through the genres", () => {
  it("finds a subgenre by its name, and by its aliases", () => {
    expect(titles(genreHits(library, "trap"))).toEqual(["Mask Off"]);
    expect(titles(genreHits(library, "slow jams"))).toEqual(["Slow Burn"]);
    expect(titles(genreHits(library, "rap")).sort()).toEqual(["Mask Off", "Real Rap"]);
  });
  it("finds 90s r&b by genre and decade", () => {
    const found = titles(genreHits(library, "90s r&b"));
    expect(found.slice(0, 2).sort()).toEqual(["Old School Jam", "Slow Burn"]);
    expect(found[2]).toBe("Unknown Year R&B");
    expect(found).toHaveLength(3);
  });
  it("puts the direct text matches first, then the genre matches", () => {
    const hits = titles(searchTracksWithGenres(library, "trap"));
    expect(hits[0]).toBe("Trapped in a Dream");
    expect(hits).toContain("Mask Off");
    expect(hits.indexOf("Trapped in a Dream")).toBeLessThan(hits.indexOf("Mask Off"));
  });
  it("a search for an artist is not widened by a genre word in the name", () => {
    const withArtist = [...library, make("Around the World", both("Electronic"), { artist: "Daft Punk" }), make("Anarchy", both("Punk"))];
    expect(titles(searchTracksWithGenres(withArtist, "daft punk"))).toEqual(["Around the World"]);
    expect(titles(searchTracksWithGenres(withArtist, "punk"))).toEqual(expect.arrayContaining(["Around the World", "Anarchy"]));
  });
  it("gives exactly the text search's answer for a query with no genre words", () => {
    expect(titles(searchTracksWithGenres(library, "unclassified"))).toEqual(titles(searchTracks(library, "unclassified")));
    expect(titles(searchTracksWithGenres(library, "zzz"))).toEqual([]);
  });
  it("lists a track once even when both ways find it", () => {
    const hits = searchTracksWithGenres(library, "rock");
    expect(new Set(hits.map((h) => h.item.id)).size).toBe(hits.length);
    expect(titles(hits)).toEqual(expect.arrayContaining(["Rock Anthem"]));
  });
  it("feeds the quick-results dropdown too", () => {
    const groups = searchAll({ tracks: library, playlists: [], fx: [] }, "slow jams");
    expect(groups[0].kind).toBe("tracks");
    expect(groups[0].kind === "tracks" && groups[0].hits.map((h) => h.item.title)).toContain("Slow Burn");
  });
  it("merges without losing or repeating a hit", () => {
    const a = [{ item: library[0], score: 50, index: 0 }];
    const b = [{ item: library[0], score: 30, index: 0 }, { item: library[1], score: 25, index: 1 }];
    expect(mergeHits(a, b).map((h) => h.item.id)).toEqual([library[0].id, library[1].id]);
    expect(mergeHits(a, [])).toEqual(a);
  });
});
