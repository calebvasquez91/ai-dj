import { describe, expect, it } from "vitest";
import {
  MANUAL_BPM_SOURCE,
  editsTempoOrKey,
  isMissingText,
  missingAnyWhere,
  missingFields,
  musicOrderBy,
  orderByCamelot,
  orderByTempo,
  shownBpm,
  shownCamelot,
  sortsInMemory,
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
    for (const v of ["", "Unknown", "unknown artist", "Unknown Artist", "Untitled", null, undefined]) expect(isMissingText(v), String(v)).toBe(true);
    expect(isMissingText("Selena")).toBe(false);
    expect(isMissingText("Unknown Mortal Orchestra")).toBe(false);
    // A real name that merely looks short is not a placeholder.
    expect(isMissingText("NA")).toBe(false);
  });

  it("is the same test the database filter makes, so the marks, the counts and the filter agree", () => {
    const text = JSON.stringify(missingAnyWhere);
    for (const placeholder of ["unknown", "unknown artist", "untitled", "untitled track", "n/a", "-"]) {
      expect(text, placeholder).toContain('"equals":"' + placeholder + '"');
      expect(isMissingText(placeholder)).toBe(true);
    }
    expect(text).not.toContain('"equals":"na"');
  });

  it("lists which of artist, name and genre a song lacks", () => {
    expect(missingFields({ artist: "Selena", title: "Bidi Bidi", genre: "Latin" })).toEqual([]);
    expect(missingFields({ artist: "", title: "Bidi Bidi", genre: null })).toEqual(["artist", "genre"]);
    expect(missingFields({ artist: "Selena", title: "Untitled", genre: "  " })).toEqual(["title", "genre"]);
    expect(missingFields({ artist: "Unknown Artist", title: "Bidi", genre: "Latin" })).toEqual(["artist"]);
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

  it("leaves tags out of a word made of the JSON's own punctuation, so it cannot match every tagged song", () => {
    for (const word of ["[", "]", '"', ",", "\\"]) expect(JSON.stringify(musicWhere(word, false)), word).not.toContain('"tagsJson"');
    expect(JSON.stringify(musicWhere("spooky", false))).toContain('"tagsJson":{"contains":"spooky"');
  });

  it("matches BPM and key as the table shows them: the app's own value, or the file's tag when the app has none", () => {
    const text = JSON.stringify(musicWhere("128", false));
    expect(text).toContain('{"bpm":{"gte":127.5,"lte":128.5}}');
    expect(text).toContain('{"AND":[{"bpm":null},{"tagBpm":{"gte":127.5,"lte":128.5}}]}');
    const key = JSON.stringify(musicWhere("8A", false));
    expect(key).toContain('{"AND":[{"key":null},{"tagKey":{"contains":"8A"');
    expect(key).toContain('{"AND":[{"camelotKey":null},{"tagCamelotKey":{"equals":"8A"');
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

  it("leaves the BPM and key sorts to the route (a tag value cannot be ordered with a measured one by the database, and text order puts 10A before 2A)", () => {
    expect(sortsInMemory("key")).toBe(true);
    expect(sortsInMemory("bpm")).toBe(true);
    expect(sortsInMemory("artist")).toBe(false);
    for (const sort of ["bpm", "key"] as const) expect(JSON.stringify(musicOrderBy(sort, "asc"))).not.toMatch(/bpm|camelot/i);
  });

  it("orders the other columns in the database", () => {
    expect(musicOrderBy("genre", "asc")[0]).toEqual({ genreInfo: { genre: { sort: "asc", nulls: "last" } } });
    expect(musicOrderBy("plays", "desc")[0]).toEqual({ playEvents: { _count: "desc" } });
  });
});

describe("orderByCamelot", () => {
  const rows = (codes: (string | null)[]) => codes.map((camelotKey, i) => ({ id: "r" + i, camelotKey }));
  const codes = (list: { camelotKey: string | null }[]) => list.map((r) => r.camelotKey);

  it("orders by the wheel, not as text", () => {
    expect(codes(orderByCamelot(rows(["10A", "2B", "1A", "12B", "2A", "10B", "9A"]), "asc"))).toEqual(["1A", "2A", "2B", "9A", "10A", "10B", "12B"]);
    expect(codes(orderByCamelot(rows(["10A", "2B", "1A"]), "desc"))).toEqual(["10A", "2B", "1A"]);
  });

  it("puts songs with no key last in both directions, and keeps the incoming order for ties", () => {
    const input = rows([null, "3A", "3A", null, "1B"]);
    expect(orderByCamelot(input, "asc").map((r) => r.id)).toEqual(["r4", "r1", "r2", "r0", "r3"]);
    expect(orderByCamelot(input, "desc").map((r) => r.id)).toEqual(["r1", "r2", "r4", "r0", "r3"]);
    expect(orderByCamelot(rows(["bogus", "2A"]), "asc").map((r) => r.camelotKey)).toEqual(["2A", "bogus"]);
  });
});

describe("the BPM and key the table shows", () => {
  it("is the app's own value, else the file's tag", () => {
    expect(shownBpm({ bpm: 120, tagBpm: 128 })).toBe(120);
    expect(shownBpm({ bpm: null, tagBpm: 128 })).toBe(128);
    expect(shownBpm({ bpm: null, tagBpm: null })).toBeNull();
    expect(shownCamelot({ camelotKey: "8A", tagCamelotKey: "5B" })).toBe("8A");
    expect(shownCamelot({ camelotKey: null, tagCamelotKey: "5B" })).toBe("5B");
  });

  it("orders by tempo with the shown value, songs with none last in both directions, ties in incoming order", () => {
    const rows = [
      { id: "a", bpm: null, tagBpm: null },
      { id: "b", bpm: null, tagBpm: 128 },
      { id: "c", bpm: 95, tagBpm: 140 },
      { id: "d", bpm: null, tagBpm: 95 },
      { id: "e", bpm: 100, tagBpm: null },
    ];
    expect(orderByTempo(rows, "asc").map((r) => r.id)).toEqual(["c", "d", "e", "b", "a"]);
    expect(orderByTempo(rows, "desc").map((r) => r.id)).toEqual(["b", "e", "c", "d", "a"]);
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
    tagBpm: null,
    tagKey: null,
    tagCamelotKey: null,
    tagsJson: '["latin","throwback"]',
    durationSec: 200,
    createdAt: new Date("2026-11-19T12:00:00Z"),
    genreInfo: { genre: "Latin", status: "needs-review", subgenresJson: '["Cumbia"]' },
    _count: { playEvents: 3 },
    ...over,
  });

  it("shapes a song for the table", () => {
    expect(toMusicRow(song())).toMatchObject({ id: "t1", genre: "Latin", subgenres: ["Cumbia"], genreStatus: "needs-review", plays: 3, tags: ["latin", "throwback"], camelot: "8A", analysed: true, missing: [] });
  });

  it("shows the file's tag BPM and key for a song the app has not measured, marked as from the tag, and the measured value when there is one", () => {
    const tagged = toMusicRow(song({ bpm: null, key: null, camelotKey: null, tagBpm: 128, tagKey: "A minor", tagCamelotKey: "8A" }));
    expect(tagged).toMatchObject({ analysed: false, bpm: 128, bpmFromTag: true, key: "A minor", camelot: "8A", keyFromTag: true });
    const measured = toMusicRow(song({ bpm: 98.4, key: "C major", camelotKey: "8B", tagBpm: 128, tagKey: "A minor", tagCamelotKey: "8A" }));
    expect(measured).toMatchObject({ analysed: true, bpm: 98.4, bpmFromTag: false, key: "C major", camelot: "8B", keyFromTag: false });
    expect(toMusicRow(song({ bpm: null, key: null, camelotKey: null })).bpm).toBeNull();
  });

  it("calls a song analysed only when it has a tempo", () => {
    expect(toMusicRow(song({ bpm: null })).analysed).toBe(false);
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

  it("clears the key and the tags with null / empty, but never the BPM", () => {
    expect(parseMusicEdit({ key: "", tags: [] })).toEqual({ ok: true, data: { key: null, camelotKey: null, tagsJson: null } });
    expect(parseMusicEdit({ bpm: null })).toMatchObject({ ok: false });
  });

  it("knows which edits touch the tempo or key (they mark the song as set by hand)", () => {
    expect(editsTempoOrKey({ bpm: 120 })).toBe(true);
    expect(editsTempoOrKey({ key: null, camelotKey: null })).toBe(true);
    expect(editsTempoOrKey({ artist: "A", tagsJson: null })).toBe(false);
    expect(MANUAL_BPM_SOURCE).toBe("manual");
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
