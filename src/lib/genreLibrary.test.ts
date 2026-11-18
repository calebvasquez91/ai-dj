import { describe, expect, it } from "vitest";
import { SOURCE_LABELS, filterByGenre, genreChipLabels, genreOverview, genresOfTrack, reviewQueue, suggestionRows } from "@/lib/genreLibrary";
import type { GenreTag, GenreTagSource, Track } from "@/types/music";

const tag = (source: GenreTagSource, genre: string, confidence: number, subgenre?: string): GenreTag => ({ genre, ...(subgenre ? { subgenre } : {}), source, confidence, updatedAt: 1 });
const track = (id: string, over: Partial<Track> = {}): Track => ({ id, title: id, artist: "a", durationSec: 1, addedAt: 0, source: "local", sourceUrl: `/api/tracks/${id}/audio`, ...over }) as Track;
const classified = (id: string, tags: GenreTag[], status: Track["genreStatus"] = "auto") => track(id, { genreTags: tags, genreStatus: status });

describe("genresOfTrack", () => {
  it("is empty for a track nobody has classified, and resolves the tags otherwise", () => {
    expect(genresOfTrack(track("a"))).toEqual([]);
    const g = genresOfTrack(classified("a", [tag("musicbrainz", "Rock", 0.7, "Soft Rock")]));
    expect(g.map((x) => x.genre)).toEqual(["Rock"]);
    expect(g[0].subgenres.map((s) => s.subgenre)).toEqual(["Soft Rock"]);
  });
  it("a person's genres decide it", () => {
    expect(genresOfTrack(classified("a", [tag("manual", "Jazz", 1), tag("lastfm", "Rock", 0.9), tag("musicbrainz", "Rock", 0.9)])).map((x) => x.genre)).toEqual(["Jazz"]);
  });
  it("shows a summary that has no tags", () => {
    expect(genresOfTrack(track("a", { genre: "Pop", subgenres: ["Synth-Pop"] })).map((g) => g.genre)).toEqual(["Pop"]);
  });
});

describe("genreOverview", () => {
  const library = [
    classified("1", [tag("musicbrainz", "Hip-Hop", 0.7, "Trap"), tag("lastfm", "Hip-Hop", 0.7, "Trap")]),
    classified("2", [tag("musicbrainz", "Hip-Hop", 0.8)]),
    classified("3", [tag("musicbrainz", "Rock", 0.7), tag("musicbrainz", "Pop", 0.6)]),
    classified("4", [tag("file-tags", "Jazz", 0.3)], "needs-review"),
    track("5"),
  ];
  it("counts a track under every genre it has, most tracks first", () => {
    const o = genreOverview(library);
    expect(o.genres.map((g) => [g.genre, g.count])).toEqual([["Hip-Hop", 2], ["Pop", 1], ["Rock", 1]]);
    expect(o.genres[0].subgenres).toEqual([{ subgenre: "Trap", count: 1 }]);
  });
  it("counts the tracks with no genre, and those waiting for review", () => {
    const o = genreOverview(library);
    expect(o.unclassified).toBe(2);
    expect(o.needsReview).toBe(1);
  });
  it("is empty for an empty library", () => {
    expect(genreOverview([])).toEqual({ genres: [], unclassified: 0, needsReview: 0 });
  });
});

describe("filterByGenre", () => {
  const library = [classified("1", [tag("musicbrainz", "Hip-Hop", 0.8, "Trap"), tag("lastfm", "Hip-Hop", 0.8, "Trap")]), classified("2", [tag("musicbrainz", "Hip-Hop", 0.8)]), classified("3", [tag("musicbrainz", "Rock", 0.8)]), track("4")];
  it("finds the tracks with a genre, or with a genre and a subgenre", () => {
    expect(filterByGenre(library, { genre: "Hip-Hop" }).map((t) => t.id)).toEqual(["1", "2"]);
    expect(filterByGenre(library, { genre: "Hip-Hop", subgenre: "Trap" }).map((t) => t.id)).toEqual(["1"]);
    expect(filterByGenre(library, { genre: "Jazz" })).toEqual([]);
  });
});

describe("suggestionRows", () => {
  it("lists what each source said, best first, in words and percent, and leaves out the person's own", () => {
    const rows = suggestionRows({ genreTags: [tag("lastfm", "Rock", 0.62), tag("musicbrainz", "Pop", 0.5, "Synth-Pop"), tag("manual", "Jazz", 1)] });
    expect(rows.map((r) => [r.label, r.sourceLabel, r.percent])).toEqual([["Rock", "Last.fm", 62], ["Pop · Synth-Pop", "MusicBrainz", 50]]);
    expect(suggestionRows({})).toEqual([]);
  });
  it("has a label for every source", () => {
    for (const s of ["file-tags", "musicbrainz", "lastfm", "audio-classifier", "llm", "manual"] as const) expect(SOURCE_LABELS[s]).toBeTruthy();
  });
});

describe("reviewQueue", () => {
  it("lists only the tracks waiting for review, the surest first", () => {
    const q = reviewQueue([
      classified("a", [tag("file-tags", "Pop", 0.3)], "needs-review"),
      classified("b", [tag("lastfm", "Rock", 0.45)], "needs-review"),
      classified("c", [tag("musicbrainz", "Rock", 0.9)], "auto"),
      classified("d", [], "needs-review"),
    ]);
    expect(q.map((t) => t.id)).toEqual(["b", "a", "d"]);
  });
});

describe("genreChipLabels", () => {
  it("gives the genres then their subgenres, and the moods", () => {
    const labels = genreChipLabels({ genreTags: [tag("musicbrainz", "Hip-Hop", 0.8, "Trap"), tag("lastfm", "Hip-Hop", 0.8, "Trap")], moods: ["chill"] });
    expect(labels).toEqual({ genres: ["Hip-Hop", "Trap"], moods: ["chill"] });
    expect(genreChipLabels({})).toEqual({ genres: [], moods: [] });
  });
});
