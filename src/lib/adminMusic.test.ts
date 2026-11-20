import { describe, expect, it } from "vitest";
import {
  isMissingText,
  missingFields,
  musicOrderBy,
  musicWhere,
  parseKeyInput,
  parseMusicEdit,
  parseMusicQuery,
  splitTagInput,
  toMusicRow,
  type MusicSongRow,
} from "./adminMusic";

describe("parseMusicQuery", () => {
  it("falls back to sane defaults", () => {
    expect(parseMusicQuery(new URLSearchParams())).toEqual({ q: "", page: 1, pageSize: 50, sort: "artist", dir: "asc", missing: false });
  });

  it("clamps everything it is given, trusting none of it", () => {
    const q = parseMusicQuery(new URLSearchParams({ q: "  daddy yankee  ", page: "-3", pageSize: "100000", sort: "password", dir: "desc", missing: "1" }));
    expect(q).toEqual({ q: "daddy yankee", page: 1, pageSize: 50, sort: "artist", dir: "desc", missing: true });
    expect(parseMusicQuery(new URLSearchParams({ page: "7", pageSize: "100", sort: "plays" }))).toMatchObject({ page: 7, pageSize: 100, sort: "plays" });
    expect(parseMusicQuery(new URLSearchParams({ page: "2.5" })).page).toBe(1);
  });
});

describe("missing info", () => {
  it("counts blanks and placeholder names as missing", () => {
    for (const v of ["", "   ", "Unknown", "unknown artist", "Untitled", null, undefined]) expect(isMissingText(v), String(v)).toBe(true);
    expect(isMissingText("Selena")).toBe(false);
    expect(isMissingText("Unknown Mortal Orchestra")).toBe(false);
  });

  it("lists which of artist, name and genre a song lacks", () => {
    expect(missingFields({ artist: "Selena", title: "Bidi Bidi", genre: "Latin" })).toEqual([]);
    expect(missingFields({ artist: "", title: "Bidi Bidi", genre: null })).toEqual(["artist", "genre"]);
    expect(missingFields({ artist: "Selena", title: "Untitled", genre: "  " })).toEqual(["title", "genre"]);
  });
});

describe("musicWhere", () => {
  it("is no filter for an empty search", () => {
    expect(musicWhere("", false)).toEqual({});
  });

  it("makes every word match something about the song", () => {
    const where = musicWhere("daddy 95", false) as { AND: { OR: unknown[] }[] };
    expect(where.AND).toHaveLength(2);
    const asText = JSON.stringify(where);
    expect(asText).toContain('"artist":{"contains":"daddy"');
    expect(asText).toContain('"tagsJson":{"contains":"daddy"');
    expect(asText).toContain('"subgenresJson"');
  });

  it("searches a number as a BPM to within half a beat, but not a word", () => {
    const num = JSON.stringify(musicWhere("128", false));
    expect(num).toContain('"bpm":{"gte":127.5,"lte":128.5}');
    expect(JSON.stringify(musicWhere("house", false))).not.toContain('"bpm"');
    expect(JSON.stringify(musicWhere("5", false))).not.toContain('"bpm"');
  });

  it("adds the missing-info filter on top of the search", () => {
    const where = musicWhere("selena", true) as { AND: unknown[] };
    expect(where.AND).toHaveLength(2);
    expect(JSON.stringify(where.AND[1])).toContain('"genreInfo"');
  });

  it("looks at no more than six words", () => {
    expect((musicWhere("a b c d e f g h", false) as { AND: unknown[] }).AND).toHaveLength(6);
  });
});

describe("musicOrderBy", () => {
  it("always ends on the song id so pages never repeat or skip a song", () => {
    for (const sort of ["artist", "title", "genre", "plays", "bpm", "key", "added"] as const) {
      const order = musicOrderBy(sort, "desc");
      expect(order[order.length - 1]).toEqual({ id: "asc" });
    }
  });

  it("puts songs with no BPM last, whichever way it sorts", () => {
    expect(musicOrderBy("bpm", "desc")[0]).toEqual({ bpm: { sort: "desc", nulls: "last" } });
    expect(musicOrderBy("plays", "desc")[0]).toEqual({ playEvents: { _count: "desc" } });
  });
});

describe("toMusicRow", () => {
  const song = (over: Partial<MusicSongRow> = {}): MusicSongRow => ({
    id: "t1",
    artist: "Selena",
    title: "Bidi Bidi Bom Bom",
    bpm: 98.4,
    key: "A minor",
    camelotKey: "8A",
    tagsJson: '["latin","throwback"]',
    durationSec: 200,
    createdAt: new Date("2026-11-19T12:00:00Z"),
    genreInfo: { genre: "Latin", status: "needs-review", subgenresJson: '["Cumbia"]' },
    _count: { playEvents: 3 },
    ...over,
  });

  it("shapes a song for the table", () => {
    expect(toMusicRow(song())).toMatchObject({ id: "t1", genre: "Latin", subgenres: ["Cumbia"], genreStatus: "needs-review", plays: 3, tags: ["latin", "throwback"], camelot: "8A", missing: [] });
  });

  it("marks a song with no classification and no artist as missing both, and survives bad JSON", () => {
    const row = toMusicRow(song({ artist: "", genreInfo: null, tagsJson: "{oops" }));
    expect(row.missing).toEqual(["artist", "genre"]);
    expect(row.genre).toBeNull();
    expect(row.tags).toEqual([]);
  });
});

describe("parseKeyInput", () => {
  it("reads names, short forms and flats", () => {
    expect(parseKeyInput("A minor")).toEqual({ key: "A minor", camelotKey: "8A" });
    expect(parseKeyInput("Am")).toEqual({ key: "A minor", camelotKey: "8A" });
    expect(parseKeyInput("C")).toEqual({ key: "C major", camelotKey: "8B" });
    expect(parseKeyInput("F# major")).toEqual({ key: "F# major", camelotKey: "2B" });
    expect(parseKeyInput("Db min")).toEqual({ key: "C# minor", camelotKey: "12A" });
    expect(parseKeyInput("Bb")).toEqual({ key: "A# major", camelotKey: "6B" });
    expect(parseKeyInput("Bbm")).toEqual({ key: "A# minor", camelotKey: "3A" });
    expect(parseKeyInput("bm")).toEqual({ key: "B minor", camelotKey: "10A" });
  });

  it("reads a Camelot code back to the key", () => {
    expect(parseKeyInput("8a")).toEqual({ key: "A minor", camelotKey: "8A" });
    expect(parseKeyInput("12B")).toEqual({ key: "E major", camelotKey: "12B" });
  });

  it("rejects what is not a key", () => {
    for (const bad of ["", "H minor", "13A", "0B", "A sharp", "minor", "A minorr"]) expect(parseKeyInput(bad), bad).toBeNull();
  });
});

describe("parseMusicEdit", () => {
  it("accepts a change to each field and tidies it", () => {
    const r = parseMusicEdit({ artist: "  Selena  ", title: "Bidi", bpm: 98.456, key: "Am", tags: ["Latin", "latin", " Throwback "] });
    expect(r).toEqual({
      ok: true,
      data: { artist: "Selena", title: "Bidi", bpm: 98.46, key: "A minor", camelotKey: "8A", tagsJson: '["Latin","Throwback"]' },
    });
  });

  it("clears BPM, key and tags with null / empty", () => {
    expect(parseMusicEdit({ bpm: null, key: "", tags: [] })).toEqual({ ok: true, data: { bpm: null, key: null, camelotKey: null, tagsJson: null } });
  });

  it("refuses a blank artist or name, a bad BPM, a bad key and a non-list of tags", () => {
    expect(parseMusicEdit({ artist: "   " })).toMatchObject({ ok: false });
    expect(parseMusicEdit({ title: 5 })).toMatchObject({ ok: false });
    for (const bpm of [10, 500, "128", NaN]) expect(parseMusicEdit({ bpm }), String(bpm)).toMatchObject({ ok: false });
    expect(parseMusicEdit({ key: "nonsense" })).toMatchObject({ ok: false });
    expect(parseMusicEdit({ tags: "a,b" })).toMatchObject({ ok: false });
  });

  it("refuses an empty or non-object body, and ignores fields it does not know", () => {
    expect(parseMusicEdit(null)).toMatchObject({ ok: false });
    expect(parseMusicEdit({})).toMatchObject({ ok: false, error: "Nothing to change." });
    expect(parseMusicEdit({ userId: "someone-else", storageKey: "x", artist: "A" })).toEqual({ ok: true, data: { artist: "A" } });
  });
});

describe("splitTagInput", () => {
  it("splits on commas and new lines and drops empties", () => {
    expect(splitTagInput("halloween, spooky,, \n horror ")).toEqual(["halloween", "spooky", "horror"]);
    expect(splitTagInput("")).toEqual([]);
  });
});
