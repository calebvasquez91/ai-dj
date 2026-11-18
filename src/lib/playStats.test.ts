import { describe, expect, it } from "vitest";
import {
  DAILY_CAP_SECONDS,
  FIRST_REPORT_SECONDS,
  MAX_SEGMENTS_PER_REQUEST,
  MAX_SEGMENT_SECONDS,
  fitToBudget,
  foldGenres,
  formatDuration,
  parseDays,
  parsePlaySegments,
  rangeStart,
  reportBudgetSeconds,
} from "./playStats";

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

describe("reportBudgetSeconds", () => {
  it("lets an honest report through: about the clock time since the last one, with room to spare", () => {
    expect(reportBudgetSeconds(30_000, 0)).toBeGreaterThanOrEqual(30);
    expect(reportBudgetSeconds(0, 0)).toBeLessThan(10); // requests faster than real time get almost nothing
  });
  it("gives a first report a fixed allowance", () => {
    expect(reportBudgetSeconds(null, 0)).toBe(FIRST_REPORT_SECONDS);
  });
  it("never credits more than a day in any 24 hours", () => {
    expect(reportBudgetSeconds(10 * 60 * 60 * 1000, DAILY_CAP_SECONDS - 100)).toBe(100);
    expect(reportBudgetSeconds(10 * 60 * 60 * 1000, DAILY_CAP_SECONDS + 5000)).toBe(0);
  });
});

describe("fitToBudget", () => {
  const seg = (trackId: string, seconds: number) => ({ trackId, playlistId: null, seconds });
  it("leaves segments that fit alone", () => {
    expect(fitToBudget([seg("a", 10), seg("b", 20)], 30)).toEqual([seg("a", 10), seg("b", 20)]);
  });
  it("scales everything down by the same factor when over budget", () => {
    expect(fitToBudget([seg("a", 100), seg("b", 300)], 40)).toEqual([seg("a", 10), seg("b", 30)]);
  });
  it("keeps nothing when there is no budget", () => {
    expect(fitToBudget([seg("a", 100)], 0)).toEqual([]);
  });
});

describe("foldGenres", () => {
  it("uses a song's current genre, then the one recorded when it was played, then 'Not classified'", () => {
    const current = new Map<string, string | null>([["t1", "Funk"], ["t2", null]]);
    const out = foldGenres(
      [
        { trackId: "t1", genre: null, seconds: 100 }, // classified after it was played
        { trackId: "t1", genre: "Pop", seconds: 50 }, // played under an old genre the admin has since corrected
        { trackId: "t2", genre: "Rock", seconds: 30 }, // no current genre: the recorded one stands
        { trackId: null, genre: "Disco", seconds: 20 }, // a deleted song keeps its recorded genre
        { trackId: "t3", genre: null, seconds: 10 }, // never classified
      ],
      current,
    );
    expect(out).toEqual([
      { label: "Funk", seconds: 150 },
      { label: "Rock", seconds: 30 },
      { label: "Disco", seconds: 20 },
      { label: "Not classified", seconds: 10 },
    ]);
  });
});
