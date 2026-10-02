import { describe, expect, it } from "vitest";
import type { FxSound, Playlist, Track } from "@/types/music";
import {
  clampPopupToViewport,
  highlightRanges,
  highlightSegments,
  MATCH_SCORE,
  normalizeText,
  normalizeWithMap,
  scoreToken,
  searchAll,
  searchFx,
  searchPlaylists,
  searchTracks,
  tokenizeQuery,
} from "@/lib/search";

let seq = 0;
function track(title: string, artist: string, tags?: string[]): Track {
  seq++;
  return { id: `t${seq}`, source: "local", sourceUrl: "x", title, artist, durationSec: 100, addedAt: 0, tags };
}
function playlist(name: string): Playlist {
  seq++;
  return { id: `p${seq}`, name, tracks: [], createdAt: 0 };
}
function fx(name: string, tags: string[] = []): FxSound {
  seq++;
  return {
    id: `f${seq}`,
    name,
    fileName: `${name}.wav`,
    sourceUrl: "x",
    mimeType: "audio/wav",
    category: "effect",
    durationSec: 2,
    tags,
    playlistAffinity: [],
    addedAt: 0,
  };
}
const titles = (hits: { item: Track }[]) => hits.map((h) => h.item.title);

describe("normalizeText", () => {
  it("lowercases and strips accents", () => {
    expect(normalizeText("Björk")).toBe("bjork");
    expect(normalizeText("BEYONCÉ")).toBe("beyonce");
    expect(normalizeText("Mötley Crüe")).toBe("motley crue");
    expect(normalizeText("Sigur Rós")).toBe("sigur ros");
  });
  it("handles empty and plain strings", () => {
    expect(normalizeText("")).toBe("");
    expect(normalizeText("abc 123")).toBe("abc 123");
  });
});

describe("normalizeWithMap", () => {
  it("maps each normalized char back to the original range", () => {
    const { norm, starts, ends } = normalizeWithMap("Bjö");
    expect(norm).toBe("bjo");
    expect(starts).toEqual([0, 1, 2]);
    expect(ends).toEqual([1, 2, 3]);
  });
  it("keeps output and map lengths aligned even when lowercasing expands a char", () => {
    const { norm, starts, ends } = normalizeWithMap("İx");
    expect(starts).toHaveLength(norm.length);
    expect(ends).toHaveLength(norm.length);
  });
  it("does not split astral characters", () => {
    const { norm, starts, ends } = normalizeWithMap("a😀b");
    expect(norm).toBe("a😀b");
    expect(starts).toHaveLength(norm.length);
    expect(ends[ends.length - 1]).toBe("a😀b".length);
  });
});

describe("tokenizeQuery", () => {
  it("splits on whitespace, normalizes and de-duplicates", () => {
    expect(tokenizeQuery("  Daft   PUNK daft ")).toEqual(["daft", "punk"]);
  });
  it("returns [] for blank queries", () => {
    expect(tokenizeQuery("")).toEqual([]);
    expect(tokenizeQuery("   \t ")).toEqual([]);
  });
  it("caps the number of tokens", () => {
    expect(tokenizeQuery("a b c d e f g h i j k l")).toHaveLength(8);
  });
});

describe("scoreToken", () => {
  it("orders exact > prefix > whole word > word start > substring", () => {
    const exact = scoreToken("love", "love");
    const prefix = scoreToken("love story", "love");
    const wordExact = scoreToken("my love story", "love");
    const wordStart = scoreToken("my lovely story", "love");
    const substring = scoreToken("glovebox", "love");
    expect(exact).toBe(MATCH_SCORE.exact);
    expect(prefix).toBe(MATCH_SCORE.prefix);
    expect(wordExact).toBe(MATCH_SCORE.wordExact);
    expect(wordStart).toBe(MATCH_SCORE.wordStart);
    expect(substring).toBe(MATCH_SCORE.substring);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordExact);
    expect(wordExact).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
  });
  it("returns 0 when there is no match or an input is empty", () => {
    expect(scoreToken("hello", "xyz")).toBe(0);
    expect(scoreToken("", "a")).toBe(0);
    expect(scoreToken("a", "")).toBe(0);
  });
  it("finds a later word-start even if an earlier hit is mid-word", () => {
    // "ove" appears inside "glove" first, then at the start of "over"
    expect(scoreToken("glove over", "ove")).toBe(MATCH_SCORE.wordStart);
  });
  it("treats punctuation as a word boundary", () => {
    expect(scoreToken("anderson .paak", "paak")).toBe(MATCH_SCORE.wordExact);
    expect(scoreToken("ac/dc", "dc")).toBe(MATCH_SCORE.wordExact);
  });
});

describe("searchTracks", () => {
  const lib = [
    track("Nightcall", "Kavinsky"),
    track("Night", "Someone"),
    track("A Midnight Run", "Band"),
    track("Tonight Tonight", "Smashing Pumpkins"),
    track("One Night Only", "Band2"),
    track("Daylight", "Maroon 5", ["night", "pop"]),
    track("Unrelated", "Nobody"),
  ];

  it("returns nothing for a blank query", () => {
    expect(searchTracks(lib, "")).toEqual([]);
    expect(searchTracks(lib, "   ")).toEqual([]);
  });

  it("ranks exact > prefix > whole word > exact tag > substring", () => {
    expect(titles(searchTracks(lib, "night"))).toEqual([
      "Night", // exact title
      "Nightcall", // prefix
      "One Night Only", // whole word, mid-title
      "Daylight", // exact tag (weighted below a title hit, above a mid-word substring)
      "A Midnight Run", // substring (mid-word), shorter title wins the tie
      "Tonight Tonight",
    ]);
  });

  it("is case-insensitive", () => {
    expect(titles(searchTracks(lib, "NIGHTCALL"))).toEqual(["Nightcall"]);
  });

  it("is accent-insensitive in both directions", () => {
    const l = [track("Jóga", "Björk"), track("Hyperballad", "Bjork Cover Band")];
    expect(titles(searchTracks(l, "bjork"))).toContain("Jóga");
    expect(titles(searchTracks(l, "BJÖRK"))).toHaveLength(2);
    expect(titles(searchTracks(l, "joga"))).toEqual(["Jóga"]);
    expect(titles(searchTracks([track("Joga", "x")], "jóga"))).toEqual(["Joga"]);
  });

  it("matches artist and tags, with title weighted above artist above tag", () => {
    const l = [
      track("Something", "Daft Punk"),
      track("Daft Punk Tribute", "Cover Band"),
      track("Else", "Other", ["daft punk"]),
    ];
    expect(titles(searchTracks(l, "daft punk"))).toEqual(["Daft Punk Tribute", "Something", "Else"]);
  });

  it("ANDs multiple words (any order, across fields)", () => {
    const l = [
      track("Get Lucky", "Daft Punk"),
      track("Lucky", "Someone Else"),
      track("Around The World", "Daft Punk"),
    ];
    expect(titles(searchTracks(l, "lucky daft"))).toEqual(["Get Lucky"]);
    expect(titles(searchTracks(l, "daft lucky"))).toEqual(["Get Lucky"]);
    expect(titles(searchTracks(l, "daft nothing"))).toEqual([]);
  });

  it("prefers a contiguous phrase over scattered words", () => {
    const l = [track("Punk Daft Mix", "X"), track("Daft Punk Mix", "Y")];
    expect(titles(searchTracks(l, "daft punk"))[0]).toBe("Daft Punk Mix");
  });

  it("breaks ties by shorter title, then library order", () => {
    const l = [track("Love Me Do Again", "A"), track("Love Me", "A"), track("Love Me", "B")];
    const hits = searchTracks(l, "love");
    expect(hits.map((h) => h.item.artist + h.item.title)).toEqual(["ALove Me", "BLove Me", "ALove Me Do Again"]);
    expect(hits[0].index).toBe(1);
  });

  it("respects the limit", () => {
    const l = Array.from({ length: 50 }, (_, i) => track(`Song ${i}`, "A"));
    expect(searchTracks(l, "song", 5)).toHaveLength(5);
    expect(searchTracks(l, "song")).toHaveLength(50);
  });

  it("handles tracks without tags or with an empty artist", () => {
    const l = [track("Solo", ""), track("Duo", "Pair", undefined)];
    expect(titles(searchTracks(l, "solo"))).toEqual(["Solo"]);
    expect(titles(searchTracks(l, "pair"))).toEqual(["Duo"]);
  });

  it("picks up an item replaced immutably (cache keyed on the object)", () => {
    const original = track("Alpha", "A");
    const l1 = [original];
    expect(searchTracks(l1, "beta")).toEqual([]);
    const edited = { ...original, title: "Beta" };
    expect(titles(searchTracks([edited], "beta"))).toEqual(["Beta"]);
  });

  it("ignores regex-special characters in the query", () => {
    const l = [track("C++ Rocks (Live)", "A"), track("Plain", "B")];
    expect(titles(searchTracks(l, "c++"))).toEqual(["C++ Rocks (Live)"]);
    expect(titles(searchTracks(l, "(live"))).toEqual(["C++ Rocks (Live)"]);
    expect(searchTracks(l, ".*")).toEqual([]);
  });
});

describe("searchPlaylists / searchFx", () => {
  it("searches playlist names with the same ranking", () => {
    const ps = [playlist("Chill Vibes"), playlist("Vibes"), playlist("Workout")];
    expect(searchPlaylists(ps, "vibes").map((h) => h.item.name)).toEqual(["Vibes", "Chill Vibes"]);
    expect(searchPlaylists(ps, "wor").map((h) => h.item.name)).toEqual(["Workout"]);
  });

  it("searches FX by name and tags", () => {
    const l = [fx("Airhorn", ["dj", "crowd"]), fx("Riser", ["build", "airy"]), fx("Scratch")];
    expect(searchFx(l, "air").map((h) => h.item.name)).toEqual(["Airhorn", "Riser"]);
    expect(searchFx(l, "crowd").map((h) => h.item.name)).toEqual(["Airhorn"]);
    expect(searchFx(l, "scr").map((h) => h.item.name)).toEqual(["Scratch"]);
    expect(searchFx(l, "zzz")).toEqual([]);
  });
});

describe("searchAll", () => {
  const data = {
    tracks: [track("Summer Nights", "Grease"), track("Winter", "Vivaldi")],
    playlists: [playlist("Summer Hits"), playlist("Chill")],
    fx: [fx("Summer Riser"), fx("Boom")],
  };

  it("returns only non-empty groups", () => {
    const groups = searchAll(data, "winter");
    expect(groups.map((g) => g.kind)).toEqual(["tracks"]);
    expect(searchAll(data, "nomatch")).toEqual([]);
    expect(searchAll(data, "")).toEqual([]);
  });

  it("puts the group holding the best hit first, ties going songs > playlists > fx", () => {
    // "summer" is a prefix of all three; equal scores -> fixed order
    expect(searchAll(data, "summer").map((g) => g.kind)).toEqual(["tracks", "playlists", "fx"]);
    // exact playlist name beats a prefix song hit
    const d2 = { ...data, playlists: [playlist("Winter")], tracks: [track("Winterfell", "X")], fx: [] };
    expect(searchAll(d2, "winter").map((g) => g.kind)).toEqual(["playlists", "tracks"]);
  });

  it("limits displayed hits per group but keeps the full list in `all`", () => {
    const tracks = Array.from({ length: 20 }, (_, i) => track(`Hit ${i}`, "A"));
    const [g] = searchAll({ tracks, playlists: [], fx: [] }, "hit", { tracks: 4, playlists: 3, fx: 3 });
    expect(g.hits).toHaveLength(4);
    expect(g.all).toHaveLength(20);
  });
});

describe("highlightRanges / highlightSegments", () => {
  it("highlights a prefix", () => {
    expect(highlightRanges("Nightcall", "night")).toEqual([[0, 5]]);
  });
  it("highlights each word and merges overlaps/adjacency", () => {
    expect(highlightRanges("Daft Punk", "daft punk")).toEqual([
      [0, 4],
      [5, 9],
    ]);
    expect(highlightRanges("Nightcall", "night call")).toEqual([[0, 9]]);
    expect(highlightRanges("abcd", "abc bcd")).toEqual([[0, 4]]);
  });
  it("prefers a word-start occurrence over an earlier mid-word one", () => {
    // "ove" inside "glove" (idx 2) vs start of "over" (idx 6)
    expect(highlightRanges("glove over", "ove")).toEqual([[6, 9]]);
  });
  it("maps accent-stripped matches back onto the original characters", () => {
    expect(highlightRanges("Björk Live", "bjork")).toEqual([[0, 5]]);
    expect(highlightRanges("Édith Piaf", "edith")).toEqual([[0, 5]]);
    expect(highlightRanges("Mötley Crüe", "crue")).toEqual([[7, 11]]);
  });
  it("returns [] when nothing matches or inputs are empty", () => {
    expect(highlightRanges("Hello", "zzz")).toEqual([]);
    expect(highlightRanges("Hello", "")).toEqual([]);
    expect(highlightRanges("", "a")).toEqual([]);
  });
  it("builds renderable segments that reassemble the text", () => {
    const segs = highlightSegments("Björk - Jóga", "bjork joga");
    expect(segs.map((s) => s.text).join("")).toBe("Björk - Jóga");
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["Björk", "Jóga"]);
    expect(highlightSegments("Hello", "zzz")).toEqual([{ text: "Hello", match: false }]);
  });
});

describe("clampPopupToViewport", () => {
  const fits = (r: ReturnType<typeof clampPopupToViewport>, vw: number, vh: number) => {
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.left + r.width).toBeLessThanOrEqual(vw);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.top + r.maxHeight).toBeLessThanOrEqual(vh);
  };

  it("stays inside a 320px-wide phone viewport", () => {
    const r = clampPopupToViewport(
      { left: 56, right: 300, bottom: 64 },
      { width: 320, height: 568 },
      { preferredWidth: 480, minWidth: 280 }
    );
    fits(r, 320, 568);
    expect(r.width).toBe(304);
    expect(r.left).toBe(8);
  });

  it("aligns to the anchor on a roomy desktop", () => {
    const r = clampPopupToViewport({ left: 400, right: 976, bottom: 64 }, { width: 1376, height: 800 });
    expect(r).toMatchObject({ left: 400, width: 576, top: 70 });
    fits(r, 1376, 800);
  });

  it("shifts left instead of overflowing the right edge", () => {
    const r = clampPopupToViewport({ left: 300, right: 340, bottom: 50 }, { width: 400, height: 600 }, { preferredWidth: 360 });
    fits(r, 400, 600);
    expect(r.width).toBe(360);
    expect(r.left).toBe(32);
  });

  it("never reports a negative height in a tiny viewport", () => {
    const r = clampPopupToViewport({ left: 0, right: 100, bottom: 500 }, { width: 200, height: 300 });
    expect(r.maxHeight).toBeGreaterThanOrEqual(0);
    fits(r, 200, 300);
  });

  it("handles a viewport narrower than twice the margin", () => {
    const r = clampPopupToViewport({ left: 0, right: 10, bottom: 10 }, { width: 10, height: 100 });
    expect(r.width).toBeGreaterThanOrEqual(0);
    expect(r.left).toBeGreaterThanOrEqual(0);
  });
});
