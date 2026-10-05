import { describe, expect, it } from "vitest";
import { alignEntryToBar, beatInBarAt, snapToDownbeatOrPhrase } from "./phrase-align";
import type { SongMap } from "./song-map";

/** A 120 BPM song: bars are 2 s long, 8-bar phrases every 16 s. */
function map(over: Partial<SongMap> = {}): SongMap {
  const downbeats = Array.from({ length: 40 }, (_, i) => i * 2);
  return {
    version: 1,
    durationSec: 80,
    bpm: 120,
    tempoConfidence: 0.6,
    beatsPerBar: 4,
    beats: [],
    downbeatPhase: 0,
    downbeatConfidence: 0.9,
    downbeats,
    phrases: {
      bars8: downbeats.filter((_, i) => i % 8 === 0),
      bars16: downbeats.filter((_, i) => i % 16 === 0),
      bars32: downbeats.filter((_, i) => i % 32 === 0),
      confidence: 0.5,
    },
    sections: [],
    ...over,
  };
}

describe("beatInBarAt", () => {
  it("is 0 on a downbeat and counts beats through the bar", () => {
    expect(beatInBarAt(map(), 10)).toBeCloseTo(0, 6);
    expect(beatInBarAt(map(), 10.5)).toBeCloseTo(1, 6);
    expect(beatInBarAt(map(), 11.25)).toBeCloseTo(2.5, 6);
    expect(beatInBarAt(map(), 11.99)).toBeLessThan(4);
  });

  it("follows a bar that is not 2 s long (a slip or tempo change)", () => {
    const m = map({ downbeats: [0, 2, 3.5, 5.5, 7.5, 9.5, 11.5, 13.5, 15.5], phrases: { bars8: [0], bars16: [0], bars32: [0], confidence: 0.5 } });
    expect(beatInBarAt(m, 2.75)).toBeCloseTo(2, 6); // halfway through a 1.5 s bar
  });

  it("is null before the first bar line and for an untrustworthy map", () => {
    expect(beatInBarAt(map({ downbeats: Array.from({ length: 40 }, (_, i) => 5 + i * 2) }), 2)).toBeNull();
    expect(beatInBarAt(map({ downbeatConfidence: 0.05 }), 10)).toBeNull();
    expect(beatInBarAt(null, 10)).toBeNull();
  });
});

describe("snapToDownbeatOrPhrase", () => {
  it("snaps to the nearest bar line", () => {
    expect(snapToDownbeatOrPhrase(map(), 21.2)).toBe(22);
    expect(snapToDownbeatOrPhrase(map(), 20.8)).toBe(20);
  });

  it("prefers an 8-bar phrase boundary within two bars", () => {
    // 16 is a phrase start; 17.9 is nearest bar line 18 but within two bars (4 s) of the phrase at 16
    expect(snapToDownbeatOrPhrase(map(), 17.9)).toBe(16);
    // 20.1 is 4.1 s from 16 and 11.9 s from 32: stays on the bar line
    expect(snapToDownbeatOrPhrase(map(), 20.1)).toBe(20);
  });

  it("ignores phrase boundaries when the phrase confidence is zero", () => {
    expect(snapToDownbeatOrPhrase(map({ phrases: { bars8: [0, 16, 32], bars16: [], bars32: [], confidence: 0 } }), 17.9)).toBe(18);
  });

  it("returns null for an untrustworthy map", () => {
    expect(snapToDownbeatOrPhrase(map({ tempoConfidence: 0.01 }), 10)).toBeNull();
    expect(snapToDownbeatOrPhrase(undefined, 10)).toBeNull();
  });
});

describe("alignEntryToBar", () => {
  it("starts on the incoming bar line when the outgoing track is on its own downbeat", () => {
    expect(alignEntryToBar(map(), 21.2, map(), 30)).toBeCloseTo(22, 6);
  });

  it("shifts the entry so both tracks are on the same beat of the bar", () => {
    // outgoing at 33 s: 0.5 bar (= beat 2 of 4) into the bar starting at 32; incoming base bar line 22 -> 22 + 0.5*2 s
    expect(alignEntryToBar(map(), 21.2, map(), 33)).toBeCloseTo(23, 6);
  });

  it("works across different tempos (the offset is a fraction of the incoming bar)", () => {
    const slow = map({ bpm: 80, downbeats: Array.from({ length: 30 }, (_, i) => i * 3), phrases: { bars8: [0, 24, 48], bars16: [0], bars32: [0], confidence: 0.5 } });
    // outgoing (2 s bars) is 1 s into its bar = half a bar; incoming bars are 3 s long -> +1.5 s past its bar line
    expect(alignEntryToBar(slow, 30.3, map(), 31)).toBeCloseTo(30 + 1.5, 6);
  });

  it("returns null if either map is untrustworthy or the outgoing time is unknown", () => {
    expect(alignEntryToBar(map(), 20, null, 30)).toBeNull();
    expect(alignEntryToBar(null, 20, map(), 30)).toBeNull();
    expect(alignEntryToBar(map(), 20, map(), null)).toBeNull();
  });
});
