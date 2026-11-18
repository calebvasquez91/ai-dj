import { describe, expect, it } from "vitest";
import { MAX_SEGMENTS_PER_REQUEST, MAX_SEGMENT_SECONDS, formatDuration, parseDays, parsePlaySegments, rangeStart, rankBySeconds } from "./playStats";

describe("parsePlaySegments", () => {
  it("keeps well-formed segments and drops everything else without failing", () => {
    const out = parsePlaySegments({
      segments: [
        { trackId: "t1", playlistId: "p1", seconds: 30 },
        null,
        "x",
        { trackId: "", seconds: 5 },
        { trackId: 7, seconds: 5 },
        { trackId: "t2", seconds: -3 },
        { trackId: "t3", seconds: 0 },
        { trackId: "t4", seconds: Number.NaN },
        { trackId: "t5", seconds: "12" },
        { trackId: "t6", playlistId: 5, seconds: 10 },
      ],
    });
    expect(out).toEqual([
      { trackId: "t1", playlistId: "p1", seconds: 30 },
      { trackId: "t6", playlistId: null, seconds: 10 },
    ]);
  });

  it("answers nothing for a body that is not a list of segments", () => {
    for (const body of [null, undefined, {}, { segments: "no" }, []]) expect(parsePlaySegments(body)).toEqual([]);
  });

  it("bounds one segment, and merges the same song and playlist", () => {
    expect(parsePlaySegments({ segments: [{ trackId: "t1", seconds: 99999 }] })[0].seconds).toBe(MAX_SEGMENT_SECONDS);
    const merged = parsePlaySegments({
      segments: [
        { trackId: "t1", playlistId: "p1", seconds: 10 },
        { trackId: "t1", playlistId: "p1", seconds: 20 },
        { trackId: "t1", playlistId: null, seconds: 5 },
      ],
    });
    expect(merged).toEqual([
      { trackId: "t1", playlistId: "p1", seconds: 30 },
      { trackId: "t1", playlistId: null, seconds: 5 },
    ]);
  });

  it("never returns more segments than one request may carry", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ trackId: `t${i}`, seconds: 1 }));
    expect(parsePlaySegments({ segments: many })).toHaveLength(MAX_SEGMENTS_PER_REQUEST);
  });
});

describe("formatDuration", () => {
  it("shows hours and minutes, and short times plainly", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(40)).toBe("40 s");
    expect(formatDuration(45 * 60)).toBe("45 min");
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(3600 * 12 + 60 * 30)).toBe("12 h 30 min");
    expect(formatDuration(-5)).toBe("0 min");
  });
});

describe("period helpers", () => {
  it("starts a window N days back, or has no start for all time", () => {
    const now = Date.UTC(2026, 10, 18, 12);
    expect(rangeStart(7, now)?.toISOString()).toBe("2026-11-11T12:00:00.000Z");
    expect(rangeStart(null, now)).toBeNull();
  });
  it("reads the period from the address: 7 or 30, otherwise all time", () => {
    expect(parseDays("7")).toBe(7);
    expect(parseDays(["30"])).toBe(30);
    for (const v of [undefined, "", "90", "abc"]) expect(parseDays(v as string | undefined)).toBeNull();
  });
});

describe("rankBySeconds", () => {
  it("orders by seconds, limits, and gives each its share of the whole", () => {
    const ranked = rankBySeconds([{ id: "a", seconds: 100 }, { id: "b", seconds: 300 }, { id: "c", seconds: 100 }], 2);
    expect(ranked.map((r) => r.id)).toEqual(["b", "a"]);
    expect(ranked[0].share).toBeCloseTo(0.6);
    expect(ranked[1].share).toBeCloseTo(0.2);
  });
  it("has no shares when nothing was played", () => {
    expect(rankBySeconds([{ seconds: 0 }], 5)[0].share).toBe(0);
  });
});
