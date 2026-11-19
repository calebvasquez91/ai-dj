import { describe, expect, it } from "vitest";
import { activityFilterParams, formatBytes, genreCountRows, limitBytes, parseActivityFilter, shortDeviceId, usageLine } from "./activity";

const tag = (genre: string, confidence = 0.9, source: "file-tags" | "llm" | "manual" = "file-tags") => ({ genre, source, confidence, updatedAt: 0 });

describe("genreCountRows: the main-genre count and the tagged-with count", () => {
  it("counts a song once under its main genre, and under every genre it carries", () => {
    const rows = [
      { genre: "Hip-Hop", tags: [tag("Hip-Hop"), tag("R&B", 0.8)] },
      { genre: "Hip-Hop", tags: [tag("Hip-Hop")] },
      { genre: "R&B", tags: [tag("R&B")] },
    ];
    expect(genreCountRows(rows)).toEqual([
      { genre: "Hip-Hop", main: 2, tagged: 2 },
      { genre: "R&B", main: 1, tagged: 2 },
    ]);
  });
  it("lists a genre that is only ever a secondary tag, with no main songs, after the others", () => {
    const rows = [
      { genre: "Pop", tags: [tag("Pop"), tag("Soul", 0.8)] },
      { genre: "Pop", tags: [tag("Pop")] },
    ];
    expect(genreCountRows(rows)).toEqual([
      { genre: "Pop", main: 2, tagged: 2 },
      { genre: "Soul", main: 0, tagged: 1 },
    ]);
  });
  it("falls back to the summary genre for a record with no tags, and skips a song with neither", () => {
    expect(genreCountRows([{ genre: "Funk", tags: [] }, { genre: null, tags: [] }])).toEqual([{ genre: "Funk", main: 1, tagged: 1 }]);
  });
  it("counts a song once for a genre even if two sources name it", () => {
    expect(genreCountRows([{ genre: "Pop", tags: [tag("Pop"), tag("Pop", 0.7, "llm")] }])).toEqual([{ genre: "Pop", main: 1, tagged: 1 }]);
  });
  it("never shows tagged below main: a stored main genre the tags no longer name still counts as tagged", () => {
    expect(genreCountRows([{ genre: "Pop", tags: [tag("Rock")] }])).toEqual([
      { genre: "Pop", main: 1, tagged: 1 },
      { genre: "Rock", main: 0, tagged: 1 },
    ]);
  });
  it("uses a person's own genres, not the old automatic ones, for a song they corrected", () => {
    const rows = [{ genre: "Funk", tags: [tag("Pop", 0.9), tag("Funk", 1, "manual")] }];
    expect(genreCountRows(rows)).toEqual([{ genre: "Funk", main: 1, tagged: 1 }]);
  });
});

describe("parseActivityFilter", () => {
  it("reads a date range and an event type from the address", () => {
    const f = parseActivityFilter({ from: "2026-11-01", to: "2026-11-19", type: "song_added" });
    expect(f.from?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(f.to?.toISOString()).toBe("2026-11-19T23:59:59.999Z");
    expect(f.type).toBe("song_added");
  });
  it("ignores anything that is not well formed", () => {
    expect(parseActivityFilter({ from: "yesterday", to: "2026-99-99", type: "drop table" })).toEqual({ from: null, to: null, type: null });
    expect(parseActivityFilter({})).toEqual({ from: null, to: null, type: null });
  });
  it("puts a range given backwards the right way round, and takes the first of a repeated value", () => {
    const f = parseActivityFilter({ from: "2026-11-19", to: "2026-11-01" });
    expect(f.from?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(f.to?.toISOString()).toBe("2026-11-19T23:59:59.999Z");
    expect(parseActivityFilter({ type: ["image_added", "song_added"] }).type).toBe("image_added");
  });
});

describe("activityFilterParams", () => {
  it("keeps only what is set", () => {
    expect(activityFilterParams({ from: "2026-11-01", to: "", type: "song_removed" }).toString()).toBe("from=2026-11-01&type=song_removed");
    expect(activityFilterParams({}).toString()).toBe("");
  });
});

describe("formatBytes and usageLine", () => {
  it("writes sizes readably", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(NaN)).toBe("—");
  });
  it("shows usage against a limit, or on its own when there is no limit", () => {
    expect(usageLine(1024 ** 3, 4 * 1024 ** 3)).toBe("1.0 GB of 4.0 GB (25%)");
    expect(usageLine(1024 ** 3, null)).toBe("1.0 GB used");
    expect(usageLine(1024, 0)).toBe("1.0 KB used");
  });
  it("reads a limit from a setting, and refuses a missing or non-positive one", () => {
    expect(limitBytes("100", 1024 ** 3)).toBe(100 * 1024 ** 3);
    for (const bad of [undefined, "", "0", "-5", "lots"]) expect(limitBytes(bad, 1024 ** 3), String(bad)).toBeNull();
  });
});

describe("shortDeviceId", () => {
  it("shows the first eight characters, or unknown", () => {
    expect(shortDeviceId("123e4567-e89b-12d3-a456-426614174000")).toBe("123e4567");
    expect(shortDeviceId(null)).toBe("unknown");
  });
});
