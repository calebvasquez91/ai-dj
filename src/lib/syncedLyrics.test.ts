import { describe, expect, it } from "vitest";
import {
  lyricsFitTrack,
  parseSyncedLyrics,
  voiceMapFromSyncedLyrics,
  voiceSegmentsFromLines,
} from "./syncedLyrics";

const LRC = `[ar:Some Artist]
[ti:Some Song]
[00:12.50] First line
[00:16.00] Second line
[00:20.25] Third line
[00:24.00]
[01:30.00] Second verse starts
[01:34.00] Another line
[01:40.00]
`;

describe("parseSyncedLyrics", () => {
  it("reads timestamps and whether a line has words, ignoring tags", () => {
    const lines = parseSyncedLyrics(LRC);
    expect(lines).toHaveLength(7);
    expect(lines[0]).toEqual({ time: 12.5, hasText: true });
    expect(lines[3]).toEqual({ time: 24, hasText: false });
    expect(lines[4].time).toBe(90);
  });

  it("handles a line with several timestamps, and out-of-order input", () => {
    const lines = parseSyncedLyrics("[00:30.00][01:00.00] chorus\n[00:05.00] intro");
    expect(lines.map((l) => l.time)).toEqual([5, 30, 60]);
    expect(lines.every((l) => l.hasText)).toBe(true);
  });

  it("returns nothing for plain, untimed lyrics", () => {
    expect(parseSyncedLyrics("just words\nno timing at all")).toEqual([]);
    expect(parseSyncedLyrics("")).toEqual([]);
  });

  it("accepts three-digit fractions and colon fractions", () => {
    expect(parseSyncedLyrics("[00:01.500] a")[0].time).toBeCloseTo(1.5);
    expect(parseSyncedLyrics("[00:01:50] a")[0].time).toBeCloseTo(1.5);
  });
});

describe("voiceSegmentsFromLines", () => {
  it("ends singing at the empty marker line", () => {
    const segs = voiceSegmentsFromLines(parseSyncedLyrics(LRC));
    expect(segs[0]).toEqual([12.5, 24]); // three lines run into each other, ending at the 24 s marker
    expect(segs[1]).toEqual([90, 100]); // second verse, ending at the 1:40 marker
  });

  it("caps a line that has no later timestamp", () => {
    const segs = voiceSegmentsFromLines(parseSyncedLyrics("[00:10.00] last line"));
    expect(segs).toEqual([[10, 17]]);
  });

  it("caps a line followed by a long gap before the next timestamp", () => {
    const segs = voiceSegmentsFromLines(parseSyncedLyrics("[00:10.00] a line\n[01:10.00] much later"));
    expect(segs[0]).toEqual([10, 17]);
    expect(segs[1][0]).toBe(70);
  });

  it("is empty when there are no sung lines", () => {
    expect(voiceSegmentsFromLines(parseSyncedLyrics("[00:10.00]\n[00:20.00]"))).toEqual([]);
  });
});

describe("lyricsFitTrack", () => {
  it("accepts a recording of the same length and rejects one that differs", () => {
    expect(lyricsFitTrack(200, 200)).toBe(true);
    expect(lyricsFitTrack(200, 205)).toBe(true);
    expect(lyricsFitTrack(200, 260)).toBe(false); // an extended mix
    expect(lyricsFitTrack(200, 150)).toBe(false);
  });

  it("rejects missing lengths", () => {
    expect(lyricsFitTrack(null, 200)).toBe(false);
    expect(lyricsFitTrack(undefined, 200)).toBe(false);
    expect(lyricsFitTrack(200, 0)).toBe(false);
  });
});

describe("voiceMapFromSyncedLyrics", () => {
  it("builds a lyrics-sourced map carrying the lyrics' own length", () => {
    const m = voiceMapFromSyncedLyrics(LRC, 215);
    expect(m).toMatchObject({ source: "lyrics", durationSec: 215 });
    expect(m?.segments).toEqual([
      [12.5, 24],
      [90, 100],
    ]);
  });

  it("keeps no words", () => {
    const m = voiceMapFromSyncedLyrics(LRC, 215);
    expect(JSON.stringify(m)).not.toMatch(/First line|Second verse/);
  });

  it("is null when nothing is timed", () => {
    expect(voiceMapFromSyncedLyrics("plain words", 200)).toBeNull();
  });
});
