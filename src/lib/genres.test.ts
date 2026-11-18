import { describe, expect, it } from "vitest";
import { GENRES, aliasKey, findNode, genreLabels, isTaxonomyNode, normalize, normalizeMany, subgenreLabels } from "@/lib/genres";
import { GENRE_KEEP_CONFIDENCE, summarizeGenreTags } from "@/lib/genreTags";
import type { GenreTag } from "@/types/music";

describe("the taxonomy", () => {
  it("has about 25 top-level genres, each with subgenres", () => {
    expect(GENRES.length).toBeGreaterThanOrEqual(24);
    expect(GENRES.length).toBeLessThanOrEqual(30);
    for (const g of GENRES) expect(g.subgenres.length, g.label).toBeGreaterThanOrEqual(3);
  });

  it("has no repeated genre label, and no repeated subgenre label within a genre", () => {
    expect(new Set(GENRES.map((g) => g.label)).size).toBe(GENRES.length);
    for (const g of GENRES) expect(new Set(g.subgenres.map((s) => s.label)).size, g.label).toBe(g.subgenres.length);
  });

  it("has the genres the app is built around", () => {
    for (const label of ["Hip-Hop", "R&B", "Pop", "Rock", "Electronic", "Latin", "Country", "Jazz", "Gospel", "Reggae/Dancehall", "Afrobeats", "Classical", "Soundtrack"]) {
      expect(genreLabels(), label).toContain(label);
    }
    expect(subgenreLabels("Hip-Hop")).toEqual(expect.arrayContaining(["Trap", "Drill", "Boom Bap", "Conscious"]));
  });

  it("never lets one name mean two different genres: no alias is shared across genres", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    const claim = (name: string, genre: string) => {
      const key = aliasKey(name);
      const have = owner.get(key);
      if (have && have !== genre) clashes.push(`${key}: ${have} / ${genre}`);
      owner.set(key, genre);
    };
    for (const g of GENRES) {
      claim(g.label, g.label);
      g.aliases.forEach((a) => claim(a, g.label));
      for (const s of g.subgenres) {
        claim(s.label, g.label);
        s.aliases.forEach((a) => claim(a, g.label));
      }
    }
    expect(clashes).toEqual([]);
  });

  it("round-trips every label through normalize()", () => {
    for (const g of GENRES) {
      expect(normalize(g.label), g.label).toEqual({ genre: g.label });
      for (const s of g.subgenres) expect(normalize(s.label), `${g.label} > ${s.label}`).toEqual({ genre: g.label, subgenre: s.label });
    }
  });
});

describe("normalize() on messy tags", () => {
  // [raw tag, genre, subgenre?]
  const cases: [string, string, string?][] = [
    // the spec's own example: three spellings of one genre
    ["Hip Hop/Rap", "Hip-Hop"],
    ["Rap", "Hip-Hop"],
    ["hip-hop", "Hip-Hop"],
    ["HIP HOP", "Hip-Hop"],
    ["  hip   hop  ", "Hip-Hop"],
    ["Hip-Hop/Rap", "Hip-Hop"],
    ["Rap Music", "Hip-Hop"],
    // case, spacing, symbols, accents
    ["R&B", "R&B"],
    ["r and b", "R&B"],
    ["RnB", "R&B"],
    ["R'n'B", "R&B"],
    ["Rhythm & Blues", "R&B"],
    ["R&B/Soul", "R&B"],
    ["Reggaetón", "Latin", "Reggaeton"],
    ["REGGAETON", "Latin", "Reggaeton"],
    ["Música Latina", "Latin"],
    ["Pop Latino", "Latin", "Latin Pop"],
    // subgenres by alias
    ["Trap Music", "Hip-Hop", "Trap"],
    ["UK Drill", "Hip-Hop", "Drill"],
    ["Boom-Bap", "Hip-Hop", "Boom Bap"],
    ["Conscious Hip Hop", "Hip-Hop", "Conscious"],
    ["Neo Soul", "R&B", "Neo-Soul"],
    ["Deep House", "Electronic", "Deep House"],
    ["Tech-House", "Electronic", "Tech House"],
    ["Drum and Bass", "Electronic", "Drum & Bass"],
    ["DnB", "Electronic", "Drum & Bass"],
    ["D&B", "Electronic", "Drum & Bass"],
    ["Dub Step", "Electronic", "Dubstep"],
    ["Lofi Hip Hop", "Electronic", "Lo-Fi"],
    ["EDM", "Electronic"],
    ["Electronica", "Electronic"],
    ["Dance", "Electronic"],
    ["Salsa", "Latin", "Salsa"],
    ["Mariachi", "Latin", "Regional Mexican"],
    ["Country & Western", "Country"],
    ["Bluegrass", "Country", "Bluegrass"],
    ["Alt-Country", "Country", "Alt-Country"],
    ["Gospel & Christian", "Gospel"],
    ["CCM", "Gospel"],
    ["Praise and Worship", "Gospel", "Praise & Worship"],
    ["Dancehall", "Reggae/Dancehall", "Dancehall"],
    ["Reggae", "Reggae/Dancehall"],
    ["Roots Reggae", "Reggae/Dancehall", "Roots Reggae"],
    ["Afrobeat", "Afrobeats", "Afrobeat"],
    ["Afro Pop", "Afrobeats"],
    ["Amapiano", "Afrobeats", "Amapiano"],
    ["OST", "Soundtrack"],
    ["Film Score", "Soundtrack", "Film Score"],
    ["Original Soundtrack", "Soundtrack"],
    ["Heavy Metal", "Metal"],
    ["Death Metal", "Metal", "Death Metal"],
    ["Punk Rock", "Punk"],
    ["Pop-Punk", "Punk", "Pop Punk"],
    ["Singer/Songwriter", "Folk", "Singer-Songwriter"],
    ["Indie Rock", "Alternative", "Indie"],
    ["Alt Rock", "Alternative"],
    ["Classic Rock", "Rock", "Classic Rock"],
    ["Rock & Roll", "Rock", "Rock & Roll"],
    ["K-Pop", "World", "K-Pop"],
    ["Christmas", "Holiday", "Christmas"],
    ["Halloween", "Holiday", "Halloween"],
    ["Smooth Jazz", "Jazz", "Smooth Jazz"],
    ["Opera", "Classical", "Opera"],
    // ID3v1 numbers, with and without wrapping
    ["(17)", "Rock"],
    ["17", "Rock"],
    ["(7)", "Hip-Hop"],
    ["(13)Pop", "Pop"],
    ["(35)", "Electronic", "House"],
    // wrappers around a real name
    ["Genre: Rock", "Rock"],
    ["The Blues", "Blues"],
    ["Jazz Music", "Jazz"],
    ["Funk genre", "Funk"],
  ];

  for (const [raw, genre, subgenre] of cases) {
    it(`${JSON.stringify(raw)} -> ${genre}${subgenre ? " > " + subgenre : ""}`, () => {
      expect(normalize(raw)).toEqual(subgenre ? { genre, subgenre } : { genre });
    });
  }

  it("covers at least 50 messy inputs", () => {
    expect(cases.length).toBeGreaterThanOrEqual(50);
  });

  it("returns null for a tag that names no genre", () => {
    for (const raw of ["", "   ", "Other", "Unknown", "Various", "Misc", "Genre", "N/A", "None", "undefined", "1994", "2021", "seen live", "favorites", "my playlist", "check this out", "female vocalists", "Café del Mar", "zzzz", "a".repeat(200)]) {
      expect(normalize(raw), JSON.stringify(raw).slice(0, 40)).toBeNull();
    }
  });

  it("returns null for an ID3 number that names nothing on the taxonomy, and for non-strings", () => {
    expect(normalize("(12)")).toBeNull();
    expect(normalize("999")).toBeNull();
    expect(normalize(null)).toBeNull();
    expect(normalize(undefined)).toBeNull();
    expect(normalize(42 as unknown as string)).toBeNull();
  });

  it("gives back a copy, so a caller cannot change the taxonomy by editing the result", () => {
    const a = normalize("Trap");
    expect(a).not.toBeNull();
    a!.genre = "Polka";
    expect(normalize("Trap")).toEqual({ genre: "Hip-Hop", subgenre: "Trap" });
  });
});

describe("normalizeMany()", () => {
  it("keeps a tag that is one alias whole, even though it has a slash or an ampersand", () => {
    expect(normalizeMany("Hip Hop/Rap")).toEqual([{ genre: "Hip-Hop" }]);
    expect(normalizeMany("R&B/Soul")).toEqual([{ genre: "R&B" }]);
    expect(normalizeMany("Drum & Bass")).toEqual([{ genre: "Electronic", subgenre: "Drum & Bass" }]);
  });

  it("splits a tag that lists several genres", () => {
    expect(normalizeMany("Rock/Pop")).toEqual([{ genre: "Rock" }, { genre: "Pop" }]);
    expect(normalizeMany("Rock; Jazz")).toEqual([{ genre: "Rock" }, { genre: "Jazz" }]);
    expect(normalizeMany("Country, Folk, Blues")).toEqual([{ genre: "Country" }, { genre: "Folk" }, { genre: "Blues" }]);
    expect(normalizeMany("Latin | Reggaeton")).toEqual([{ genre: "Latin" }, { genre: "Latin", subgenre: "Reggaeton" }]);
  });

  it("drops the parts that name no genre, and repeats", () => {
    expect(normalizeMany("Rock; seen live; 1994; rock")).toEqual([{ genre: "Rock" }]);
    expect(normalizeMany("Other; Unknown")).toEqual([]);
    expect(normalizeMany("")).toEqual([]);
    expect(normalizeMany(null)).toEqual([]);
  });
});

describe("findNode / isTaxonomyNode", () => {
  it("accepts a stored label pair that is on the taxonomy and refuses one that is not", () => {
    expect(findNode("Hip-Hop", "Trap")).toEqual({ genre: "Hip-Hop", subgenre: "Trap" });
    expect(findNode("Hip-Hop")).toEqual({ genre: "Hip-Hop" });
    expect(isTaxonomyNode("Hip-Hop", "Polka")).toBe(false);
    expect(isTaxonomyNode("Polka")).toBe(false);
    expect(isTaxonomyNode("trap")).toBe(false);
  });
});

describe("summarizeGenreTags", () => {
  const tag = (genre: string, confidence: number, extra: Partial<GenreTag> = {}): GenreTag => ({ genre, source: "musicbrainz", confidence, updatedAt: 1, ...extra });

  it("is empty with no tags", () => {
    expect(summarizeGenreTags(undefined)).toEqual({ genre: undefined, genres: [], subgenres: [] });
    expect(summarizeGenreTags([])).toEqual({ genre: undefined, genres: [], subgenres: [] });
  });

  it("keeps every genre at or above the threshold, best first, and a track can have several", () => {
    expect(GENRE_KEEP_CONFIDENCE).toBe(0.5);
    const s = summarizeGenreTags([tag("Pop", 0.55), tag("R&B", 0.9, { subgenre: "Neo-Soul" }), tag("Rock", 0.3)]);
    expect(s.genre).toBe("R&B");
    expect(s.genres).toEqual(["R&B", "Pop"]);
    expect(s.subgenres).toEqual(["Neo-Soul"]);
  });

  it("leaves out a tag below the threshold, and one that is not on the taxonomy", () => {
    expect(summarizeGenreTags([tag("Pop", 0.49), tag("Polka", 0.95), tag("Hip-Hop", 0.8, { subgenre: "Polka" })]).genres).toEqual([]);
    expect(summarizeGenreTags([tag("Pop", 0.5)]).genres).toEqual(["Pop"]);
  });

  it("does not list a genre or a subgenre twice, and a person's tag decides the summary", () => {
    const s = summarizeGenreTags([
      tag("Hip-Hop", 0.9, { subgenre: "Trap", source: "musicbrainz" }),
      tag("Hip-Hop", 0.6, { subgenre: "Trap", source: "lastfm" }),
      tag("Hip-Hop", 1, { subgenre: "Drill", source: "manual" }),
    ]);
    expect(s.genres).toEqual(["Hip-Hop"]);
    expect(s.subgenres).toEqual(["Drill"]);
  });

  it("does not change the array it is given", () => {
    const tags = [tag("Pop", 0.6), tag("Rock", 0.9)];
    summarizeGenreTags(tags);
    expect(tags.map((t) => t.genre)).toEqual(["Pop", "Rock"]);
  });
});
