import { describe, expect, it } from "vitest";
import { computeGenreStats, latestPerTrack, type LogRow } from "@/lib/genre/stats";

const row = (trackId: string, over: Partial<LogRow> & { sources?: object[] } = {}): LogRow => {
  const { sources, ...rest } = over;
  return {
    trackId,
    status: "auto",
    genre: "Rock",
    confidence: 0.8,
    sourcesJson: JSON.stringify(sources ?? [{ source: "file-tags", ran: true, tags: 1, ms: 10 }, { source: "musicbrainz", ran: true, tags: 0, ms: 1100 }]),
    usedLlm: false,
    createdAt: new Date("2026-11-17T10:00:00Z"),
    ...rest,
  };
};

describe("latestPerTrack", () => {
  it("keeps each track's most recent classification only", () => {
    const rows = [row("a", { confidence: 0.4, createdAt: new Date("2026-11-17T09:00:00Z") }), row("a", { confidence: 0.9 }), row("b")];
    const latest = latestPerTrack(rows);
    expect(latest).toHaveLength(2);
    expect(latest.find((l) => l.trackId === "a")!.confidence).toBe(0.9);
  });
});

describe("computeGenreStats", () => {
  it("reports how much of the library is classified and how much needs review", () => {
    const s = computeGenreStats({ totalTracks: 200, records: 150, classified: 150, needsReview: 30, confirmed: 10, logs: [] });
    expect(s.percentClassified).toBe(75);
    expect(s.percentNeedsReview).toBe(20);
    expect(s.averageConfidence).toBeNull();
    expect(s.sources).toEqual([]);
    expect(s.logged).toBe(0);
  });
  it("is zeroes, not NaN, for an empty library", () => {
    const s = computeGenreStats({ totalTracks: 0, records: 0, classified: 0, needsReview: 0, confirmed: 0, logs: [] });
    expect(s).toMatchObject({ percentClassified: 0, percentNeedsReview: 0, percentUsedLlm: 0, averageConfidence: null });
  });
  it("gives each source's hit rate over the runs it actually made, and skips the ones that did not run", () => {
    const logs = [
      row("a", { sources: [{ source: "file-tags", ran: true, tags: 1, ms: 10 }, { source: "lastfm", ran: true, tags: 2, ms: 300 }, { source: "llm", ran: false, tags: 0, ms: 0 }] }),
      row("b", { sources: [{ source: "file-tags", ran: true, tags: 0, ms: 20 }, { source: "lastfm", ran: true, tags: 0, ms: 100 }] }),
      row("c", { sources: [{ source: "file-tags", ran: true, tags: 1, ms: 30 }, { source: "fingerprint", ran: true, tags: 0, ms: 50, hit: true }, { source: "musicbrainz", ran: false, tags: 0, ms: 0 }] }),
    ];
    const s = computeGenreStats({ totalTracks: 3, records: 3, classified: 3, needsReview: 0, confirmed: 0, logs });
    const by = Object.fromEntries(s.sources.map((x) => [x.source, x]));
    expect(by["file-tags"]).toMatchObject({ runs: 3, hits: 2, avgMs: 20 });
    expect(by["file-tags"].hitRate).toBeCloseTo(2 / 3);
    expect(by.lastfm).toMatchObject({ runs: 2, hits: 1, hitRate: 0.5, avgMs: 200 });
    expect(by.fingerprint).toMatchObject({ runs: 1, hits: 1, hitRate: 1 });
    expect(by.llm).toBeUndefined();
    expect(by.musicbrainz).toBeUndefined();
    expect(s.sources.map((x) => x.source)).toEqual(["file-tags", "fingerprint", "lastfm"]);
  });
  it("averages the confidence and the LLM share over each track's latest classification", () => {
    const logs = [
      row("a", { confidence: 0.4, createdAt: new Date("2026-11-17T08:00:00Z"), usedLlm: true }),
      row("a", { confidence: 0.8 }),
      row("b", { confidence: 0.6, usedLlm: true }),
      row("c", { confidence: null }),
    ];
    const s = computeGenreStats({ totalTracks: 3, records: 3, classified: 2, needsReview: 1, confirmed: 0, logs });
    expect(s.logged).toBe(3);
    expect(s.averageConfidence).toBe(0.7);
    expect(s.percentUsedLlm).toBe(33.3);
  });
  it("survives a log row whose sources are not valid JSON", () => {
    const s = computeGenreStats({ totalTracks: 1, records: 1, classified: 1, needsReview: 0, confirmed: 0, logs: [row("a", { sourcesJson: "not json" }), row("b", { sourcesJson: "{}" })] });
    expect(s.sources).toEqual([]);
    expect(s.logged).toBe(2);
  });
});
