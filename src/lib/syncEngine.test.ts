import { describe, expect, it } from "vitest";
import {
  FREEFORM_CROSSFADE_MS,
  STEM_SWAP_ORDER,
  buildSyncReport,
  candidateSyncSummary,
  describeSyncReport,
  energyStrategyFor,
  planBpm,
  planKey,
  shiftCamelot,
  stemSwapTimings,
} from "./syncEngine";
import { camelotCompatibility } from "./mix-engine";
import type { TrackAnalysis } from "./audio-analysis";
import type { SongMap } from "./song-map";
import type { Track } from "@/types/music";

function makeTrack(id: string, durationSec = 200): Track {
  return { id, title: id, artist: "Test Artist", durationSec, addedAt: 0, source: "local", sourceUrl: `blob:${id}` };
}

function makeAnalysis(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return {
    bpm: 128,
    bpmConfidence: 0.8,
    beatGridOffsetSec: 0,
    energyOnsetSec: 8,
    key: "A minor",
    keyConfidence: 0.6,
    camelotKey: "8A",
    breakdownAtSec: null,
    dropAtSec: null,
    buildDropPairs: [],
    waveformPeaks: [],
    fallback: false,
    ...overrides,
  };
}

describe("planBpm", () => {
  const conf = { bpmConfidence: 0.8 };

  it("is exact within 2 BPM and leaves B untouched", () => {
    const p = planBpm({ bpm: 128, ...conf }, { bpm: 129.5, ...conf });
    expect(p.bpmStrategy).toBe("exact");
    expect(p.stretchAmount).toBe(1);
    expect(p.bpmDelta).toBeCloseTo(1.5);
  });

  it("stretches B onto A's tempo between 2 and 8 BPM apart", () => {
    const p = planBpm({ bpm: 128, ...conf }, { bpm: 132.43, ...conf });
    expect(p.bpmStrategy).toBe("stretch");
    expect(p.stretchAmount).toBeCloseTo(128 / 132.43);
    expect(p.bpmRatio).toBeCloseTo(132.43 / 128);
  });

  it("plays a double-tempo track at half rate, and a half-tempo track at double", () => {
    const half = planBpm({ bpm: 70, ...conf }, { bpm: 141, ...conf });
    expect(half.bpmStrategy).toBe("halftime");
    expect(half.stretchAmount).toBeCloseTo(70 / 141);
    const dbl = planBpm({ bpm: 140, ...conf }, { bpm: 69, ...conf });
    expect(dbl.bpmStrategy).toBe("doubletime");
    expect(dbl.stretchAmount).toBeCloseTo(140 / 69);
  });

  it("goes freeform (no stretch) when the gap is too wide to stretch cleanly", () => {
    for (const b of [130.5, 140]) {
      const p = planBpm({ bpm: 120, ...conf }, { bpm: b, ...conf });
      expect(p.bpmStrategy).toBe("freeform");
      expect(p.stretchAmount).toBe(1);
    }
  });

  it("never stretches toward a tempo it isn't sure of", () => {
    const p = planBpm({ bpm: 128, ...conf }, { bpm: 131, bpmConfidence: 0.1 });
    expect(p.bpmStrategy).toBe("freeform");
    expect(p.tempoConfident).toBe(false);
    expect(p.stretchAmount).toBe(1);
  });
});

describe("shiftCamelot", () => {
  it("moves seven wheel numbers per semitone, keeping the mode", () => {
    expect(shiftCamelot("8A", 1)).toBe("3A");
    expect(shiftCamelot("8A", -1)).toBe("1A");
    expect(shiftCamelot("8B", 12)).toBe("8B");
    expect(shiftCamelot("10A", -2)).toBe("8A");
  });

  it("rejects junk", () => {
    expect(shiftCamelot("13A", 1)).toBeNull();
    expect(shiftCamelot("nope", 1)).toBeNull();
  });
});

describe("planKey", () => {
  const key = (camelotKey: string | null, keyConfidence = 0.6) => ({ camelotKey, key: camelotKey ? `k${camelotKey}` : null, keyConfidence });

  it("same key is perfect and needs no shift", () => {
    const p = planKey(key("8A"), key("8A"));
    expect(p.keyCompatibility).toBe("perfect");
    expect(p.pitchShiftSemitones).toBe(0);
    expect(p.semitoneDelta).toBe(0);
  });

  it("relative major/minor and adjacent keys are compatible, not tension", () => {
    expect(planKey(key("8A"), key("8B")).keyCompatibility).toBe("compatible");
    expect(planKey(key("8A"), key("9A")).keyCompatibility).toBe("compatible");
    expect(planKey(key("8A"), key("7A")).pitchShiftSemitones).toBe(0);
  });

  it("reports the semitones from B's tonic up to A's", () => {
    expect(planKey(key("8B"), key("8A")).semitoneDelta).toBe(3); // shift A minor up 3 to reach C
    expect(planKey(key("8B"), key("9B")).semitoneDelta).toBe(5); // G major up 5 to reach C
  });

  it("a whole step round the wheel is tension, and a two-semitone shift fixes it", () => {
    const p = planKey(key("8A"), key("10A"));
    expect(p.keyCompatibility).toBe("tension");
    expect(p.pitchShiftSemitones).toBe(-2);
  });

  it("a clash is resolved by the smallest shift that lands on a compatible key", () => {
    const p = planKey(key("8A"), key("11A"));
    expect(p.keyCompatibility).toBe("clash");
    expect(Math.abs(p.pitchShiftSemitones)).toBeLessThanOrEqual(3);
    expect(camelotCompatibility("8A", shiftCamelot("11A", p.pitchShiftSemitones))).toBeGreaterThanOrEqual(1);
  });

  it("always picks the smallest shift that lands compatible, and none past the limit", () => {
    let unfixable = 0;
    for (let n = 1; n <= 12; n++) {
      for (const letter of ["A", "B"]) {
        const code = `${n}${letter}`;
        const p = planKey(key("8A"), key(code));
        const size = Math.abs(p.pitchShiftSemitones);
        expect(size).toBeLessThanOrEqual(3);
        if (p.keyCompatibility === "perfect" || p.keyCompatibility === "compatible") {
          expect(p.pitchShiftSemitones).toBe(0);
          continue;
        }
        const reachable = [-3, -2, -1, 1, 2, 3].some((s) => camelotCompatibility("8A", shiftCamelot(code, s)) >= 1);
        if (!reachable) {
          // a mixed-mode pair has only the relative key as a target, which can be more than 3 semitones away
          expect(p.pitchShiftSemitones).toBe(0);
          unfixable++;
          continue;
        }
        expect(camelotCompatibility("8A", shiftCamelot(code, p.pitchShiftSemitones))).toBeGreaterThanOrEqual(1);
        for (let smaller = 1; smaller < size; smaller++) {
          for (const sign of [1, -1]) {
            expect(camelotCompatibility("8A", shiftCamelot(code, sign * smaller))).toBe(0);
          }
        }
      }
    }
    expect(unfixable).toBe(5);
  });

  it("applies the shift fully to melody and vocals, half to bass, never to drums", () => {
    const p = planKey(key("8A"), key("10A"));
    expect(p.stemPitchShifts).toEqual({ drums: 0, bass: -1, melody: -2, vocals: -2 });
  });

  it("says unknown, and shifts nothing, when a key isn't trustworthy", () => {
    expect(planKey(key("8A"), key(null)).keyCompatibility).toBe("unknown");
    const lowConf = planKey(key("8A"), key("10A", 0.01));
    expect(lowConf.keyCompatibility).toBe("unknown");
    expect(lowConf.pitchShiftSemitones).toBe(0);
  });
});

describe("energyStrategyFor", () => {
  it("reads the arc from the two energies", () => {
    expect(energyStrategyFor(0.5, 0.55)).toBe("sustain");
    expect(energyStrategyFor(0.4, 0.7)).toBe("build");
    expect(energyStrategyFor(0.8, 0.5)).toBe("release");
    expect(energyStrategyFor(0.9, 0.2)).toBe("contrast");
    expect(energyStrategyFor(null, 0.5)).toBe("sustain");
  });
});

describe("stemSwapTimings", () => {
  it("swaps one stem per bar from bar 2 on a long crossfade", () => {
    expect(stemSwapTimings(120, 32)).toEqual([2000, 4000, 6000, 8000]);
  });

  it("compresses to two beats per stem on a short one", () => {
    expect(stemSwapTimings(120, 16)).toEqual([1000, 2000, 3000, 4000]);
  });

  it("never schedules a swap past the last beat of the window", () => {
    expect(stemSwapTimings(120, 4)).toEqual([1000, 1500, 1500, 1500]);
  });
});

describe("buildSyncReport", () => {
  const plan = { windowSec: 16, windowBeats: 32, incomingEntryOffsetSec: 12, transitionId: "bass-swap" };

  it("combines tempo, key, timing, energy and stems into one report", () => {
    const r = buildSyncReport({
      current: { track: makeTrack("a", 200), analysis: makeAnalysis({ bpm: 120, camelotKey: "8A" }) },
      next: { track: makeTrack("b", 200), analysis: makeAnalysis({ bpm: 124, camelotKey: "10A" }) },
      plan,
    });
    expect(r.bpmStrategy).toBe("stretch");
    expect(r.stretchAmount).toBeCloseTo(120 / 124);
    expect(r.keyCompatibility).toBe("tension");
    expect(r.pitchShiftSemitones).toBe(-2);
    expect(r.mixOutMs).toBe(184_000); // natural end (200) minus the 16 s window, on the beat grid
    expect(r.mixOutOnDownbeat).toBe(false);
    expect(r.mixInMs).toBe(12_000);
    expect(r.crossfadeDurationMs).toBe(16_000);
    expect(r.transitionStyle).toBe("bass-swap");
    expect(r.stemSwapOrder).toEqual([...STEM_SWAP_ORDER]);
    expect(r.stemSwapTimings).toEqual([2000, 4000, 6000, 8000]);
    expect(r.stemSwapAvailable).toBe(false);
  });

  it("never plans to leave a track before where it already is", () => {
    const r = buildSyncReport({
      current: { track: makeTrack("a", 200), analysis: makeAnalysis({ bpm: 120 }) },
      next: { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 120 }) },
      plan,
      currentElapsedSec: 190,
    });
    expect(r.mixOutMs).toBeGreaterThanOrEqual(190_000);
  });

  it("honours a requested mix-out point (e.g. a voice cut-off)", () => {
    const r = buildSyncReport({
      current: { track: makeTrack("a", 200), analysis: makeAnalysis({ bpm: 120 }) },
      next: { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 120 }) },
      plan,
      mixOutSec: 100.2,
    });
    expect(r.mixOutMs).toBe(100_000); // snapped to the 0.5 s beat grid
  });

  it("snaps the mix-out onto a bar line when the song map is trustworthy", () => {
    const downbeats = Array.from({ length: 50 }, (_, i) => i * 2); // 120 BPM: a bar every 2 s
    const songMap = {
      version: 1,
      durationSec: 200,
      bpm: 120,
      tempoConfidence: 0.9,
      beatsPerBar: 4,
      beats: [],
      downbeatPhase: 0,
      downbeatConfidence: 0.9,
      downbeats,
      phrases: { bars8: [], bars16: [], bars32: [], confidence: 0 },
      sections: [],
    } as SongMap;
    const r = buildSyncReport({
      current: { track: makeTrack("a", 200), analysis: makeAnalysis({ bpm: 120, songMap }) },
      next: { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 120 }) },
      plan,
      mixOutSec: 61,
    });
    expect(r.mixOutOnDownbeat).toBe(true);
    expect((r.mixOutMs / 1000) % 2).toBe(0);
  });

  it("uses the long masked crossfade when tempos can't be reconciled", () => {
    const r = buildSyncReport({
      current: { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 100 }) },
      next: { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 140 }) },
      plan,
    });
    expect(r.bpmStrategy).toBe("freeform");
    expect(r.crossfadeDurationMs).toBe(FREEFORM_CROSSFADE_MS);
  });

  it("works without a plan, using the outgoing tempo for a default window", () => {
    const r = buildSyncReport({
      current: { track: makeTrack("a", 200), analysis: makeAnalysis({ bpm: 120 }) },
      next: { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 120, energyOnsetSec: 5 }) },
    });
    expect(r.crossfadeDurationMs).toBe(8000); // 16 beats at 120 BPM = 8 s
    expect(r.mixInMs).toBe(5000);
    expect(r.transitionStyle).toBe("blend");
  });

  it("marks the stem hand-over available only when both tracks' stems are ready", () => {
    const base = {
      current: { track: makeTrack("a"), analysis: makeAnalysis() },
      next: { track: makeTrack("b"), analysis: makeAnalysis() },
    };
    expect(buildSyncReport({ ...base, incomingStemsReady: true }).stemSwapAvailable).toBe(false);
    expect(buildSyncReport({ ...base, incomingStemsReady: true, outgoingStemsReady: true }).stemSwapAvailable).toBe(true);
  });
});

describe("describeSyncReport", () => {
  it("reads like the DJ board line", () => {
    const r = buildSyncReport({
      current: { track: makeTrack("a", 200), analysis: makeAnalysis({ bpm: 128, camelotKey: "8A" }) },
      next: { track: makeTrack("b", 200), analysis: makeAnalysis({ bpm: 132, camelotKey: "10A" }) },
      plan: { windowSec: 16, windowBeats: 32, incomingEntryOffsetSec: 8, transitionId: "x" },
      mixOutSec: 192,
    });
    expect(describeSyncReport(r, "Midnight Pulse")).toBe(
      "Next: Midnight Pulse — BPM stretch -3.0% — Key shift -2 semitones — Mix out at 3:12 on beat"
    );
  });

  it("describes a same-key, matched-tempo pair plainly", () => {
    const r = buildSyncReport({
      current: { track: makeTrack("a"), analysis: makeAnalysis({ bpm: 128 }) },
      next: { track: makeTrack("b"), analysis: makeAnalysis({ bpm: 128 }) },
    });
    expect(describeSyncReport(r, "T")).toMatch(/^Next: T — BPM matched — same key — Mix out at /);
  });
});

describe("candidateSyncSummary", () => {
  it("gives the AI the compact tempo/key picture for a candidate", () => {
    const s = candidateSyncSummary(makeAnalysis({ bpm: 128, camelotKey: "8A" }), makeAnalysis({ bpm: 132.5, camelotKey: "10A" }));
    expect(s).toEqual({
      bpmStrategy: "stretch",
      bpmDelta: 4.5,
      stretchPercent: -3.4,
      keyCompatibility: "tension",
      pitchShiftSemitones: -2,
    });
  });

  it("withholds a delta it can't trust", () => {
    const s = candidateSyncSummary(makeAnalysis(), makeAnalysis({ bpmConfidence: 0.05 }));
    expect(s.bpmDelta).toBeNull();
    expect(s.bpmStrategy).toBe("freeform");
  });
});
