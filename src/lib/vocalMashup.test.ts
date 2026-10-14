import { describe, expect, it } from "vitest";
import {
  VOCAL_MASHUP_HANDOFF_BARS,
  VOCAL_MASHUP_HOLD_LEVEL,
  VOCAL_MASHUP_MIN_HOLD_BARS,
  VOCAL_MASHUP_CAP_MARGIN_SEC,
  vocalMashupBeatsTheCap,
  gridPointAtOrBefore,
  instrumentalFromMixAndVocal,
  isVocalMashupPair,
  nextGridPointAfter,
  planVocalMashup,
  toMashupPlan,
  vocalMashupGainCurves,
  vocalMashupGainsAt,
  vocalMashupPhase,
  vocalMashupTempoPitchAt,
  type VocalMashupInput,
} from "./vocalMashup";
import type { TrackAnalysis } from "./audio-analysis";
import type { SongMap } from "./song-map";
import type { Track } from "@/types/music";

function track(id: string, durationSec = 240): Track {
  return { id, title: id.toUpperCase(), artist: "T", durationSec, addedAt: 0, source: "local", sourceUrl: `blob:${id}` };
}

function analysis(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return {
    bpm: 120,
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

function input(overrides: Partial<VocalMashupInput> = {}): VocalMashupInput {
  return {
    current: { track: track("a"), analysis: analysis() },
    next: { track: track("b"), analysis: analysis({ bpm: 124, camelotKey: "9A" }) },
    currentTimeSec: 100,
    currentDurationSec: 240,
    voiceCutoffSec: 100,
    nextFirstVoiceSec: 20,
    ...overrides,
  };
}

describe("vocalMashupBeatsTheCap", () => {
  it("is true only when the voices end comfortably before the engine's 150 s active-play cap", () => {
    expect(vocalMashupBeatsTheCap(60)).toBe(true);
    expect(vocalMashupBeatsTheCap(150 - VOCAL_MASHUP_CAP_MARGIN_SEC - 1)).toBe(true);
    expect(vocalMashupBeatsTheCap(150 - VOCAL_MASHUP_CAP_MARGIN_SEC)).toBe(false);
    expect(vocalMashupBeatsTheCap(200)).toBe(false);
    expect(vocalMashupBeatsTheCap(null)).toBe(false);
  });
});

describe("isVocalMashupPair", () => {
  it("needs compatible keys and a tempo within the mashup stretch range", () => {
    expect(isVocalMashupPair(input().current, input().next)).toBe(true);
    expect(isVocalMashupPair(input().current, { track: track("b"), analysis: analysis({ camelotKey: "3B" }) })).toBe(false);
    expect(isVocalMashupPair(input().current, { track: track("b"), analysis: analysis({ bpm: 170 }) })).toBe(false);
  });
});

describe("grid helpers", () => {
  const map = {
    version: 1,
    durationSec: 240,
    bpm: 120,
    tempoConfidence: 0.9,
    beatsPerBar: 4,
    beats: [],
    downbeatPhase: 0,
    downbeatConfidence: 0.9,
    downbeats: Array.from({ length: 120 }, (_, i) => i * 2), // a bar every 2 s
    phrases: { bars8: [], bars16: [], bars32: [], confidence: 0 },
    sections: [],
  } as SongMap;

  it("uses bar lines when the song map is trustworthy", () => {
    const a = analysis({ songMap: map });
    expect(nextGridPointAfter(a, 10.3)).toBe(12);
    expect(gridPointAtOrBefore(a, 13.9)).toBe(12);
  });

  it("falls back to the beat grid, honouring its offset", () => {
    const a = analysis({ bpm: 120, beatGridOffsetSec: 0.1 }); // a beat every 0.5 s starting at 0.1
    expect(nextGridPointAfter(a, 10.3)).toBeCloseTo(10.6);
    expect(gridPointAtOrBefore(a, 10.3)).toBeCloseTo(10.1);
  });

  it("never goes before the start of the track", () => {
    expect(gridPointAtOrBefore(analysis({ beatGridOffsetSec: 0.4 }), 0.1)).toBe(0);
  });
});

describe("planVocalMashup", () => {
  it("waits until the outgoing track's voices are done", () => {
    expect(planVocalMashup(input({ currentTimeSec: 90 }))).toBeNull();
    expect(planVocalMashup(input({ voiceCutoffSec: null }))).toBeNull();
  });

  it("is null for a pair that isn't mashable", () => {
    expect(planVocalMashup(input({ next: { track: track("b"), analysis: analysis({ camelotKey: "3B" }) } }))).toBeNull();
  });

  it("holds the vocal for about half a minute in whole bars, then hands off over eight bars", () => {
    const p = planVocalMashup(input())!;
    const barSec = 2; // 120 BPM
    expect(p.holdBars).toBe(15); // 30 s
    expect(p.holdSec).toBeCloseTo(30);
    expect(p.handoffSec).toBeCloseTo(VOCAL_MASHUP_HANDOFF_BARS * barSec);
    expect(p.totalSec).toBeCloseTo(p.holdSec + p.handoffSec);
  });

  it("starts on the outgoing track's next bar/beat, not immediately", () => {
    const p = planVocalMashup(input({ currentTimeSec: 100.1 }))!;
    expect(p.startDelaySec).toBeGreaterThan(0.2);
    expect(p.startDelaySec).toBeLessThanOrEqual(0.5 + 0.26);
    // the entry lands on a beat: start time is a multiple of the 0.5 s beat
    expect(((100.1 + p.startDelaySec) / 0.5) % 1).toBeCloseTo(0, 5);
  });

  it("shortens the hold to fit what is left of the outgoing file", () => {
    const p = planVocalMashup(input({ currentDurationSec: 100 + 45 }))!; // 45 s left: 16 s hand-off leaves ~28 s
    expect(p.holdBars).toBeLessThan(15);
    expect(p.startDelaySec + p.totalSec).toBeLessThan(45);
  });

  it("gives up (normal transition) when even the minimum hold plus hand-off won't fit", () => {
    const barSec = 2;
    const tooShort = (VOCAL_MASHUP_MIN_HOLD_BARS + VOCAL_MASHUP_HANDOFF_BARS) * barSec - 4;
    expect(planVocalMashup(input({ currentDurationSec: 100 + tooShort }))).toBeNull();
  });

  it("enters the incoming track on a beat at or just before its first voice", () => {
    const p = planVocalMashup(input({ nextFirstVoiceSec: 20.3 }))!;
    expect(p.entryOffsetSec).toBeLessThanOrEqual(20.35);
    expect(p.entryOffsetSec).toBeGreaterThan(19.5);
    expect((p.entryOffsetSec / (60 / 124)) % 1).toBeCloseTo(0, 5);
  });

  it("falls back to the incoming energy onset when its first voice is unknown", () => {
    const p = planVocalMashup(input({ nextFirstVoiceSec: null }))!;
    expect(p.entryOffsetSec).toBeLessThanOrEqual(8.05);
  });

  it("matches tempo to the outgoing track and shifts adjacent keys onto it", () => {
    const p = planVocalMashup(input())!;
    expect(p.tempoRatio).toBeCloseTo(120 / 124);
    expect(p.pitchSemitones).not.toBe(0); // 9A -> 8A is an adjacent-key (fifth) move
    const same = planVocalMashup(input({ next: { track: track("b"), analysis: analysis({ bpm: 124, camelotKey: "8B" }) } }))!;
    expect(same.pitchSemitones).toBe(0); // relative major/minor: already compatible
  });

  it("converts to the runner's MashupPlan shape", () => {
    const p = planVocalMashup(input())!;
    const m = toMashupPlan(p);
    expect(m).toMatchObject({ tempoRatio: p.tempoRatio, pitchSemitones: p.pitchSemitones, entryOffsetSec: p.entryOffsetSec });
    expect(m.durationSec).toBeCloseTo(p.totalSec);
    expect(m.barsCount).toBe(p.holdBars + VOCAL_MASHUP_HANDOFF_BARS);
  });
});

describe("gains and easing", () => {
  const plan = planVocalMashup(input())!;

  it("fades the vocal in, holds, then swaps outgoing for incoming instrumental", () => {
    const start = vocalMashupGainsAt(plan, 0);
    expect(start).toEqual({ out: VOCAL_MASHUP_HOLD_LEVEL, vocal: 0, inst: 0 });
    const hold = vocalMashupGainsAt(plan, plan.holdSec - 0.01);
    expect(hold.out).toBeCloseTo(VOCAL_MASHUP_HOLD_LEVEL);
    expect(hold.vocal).toBeCloseTo(VOCAL_MASHUP_HOLD_LEVEL);
    expect(hold.inst).toBe(0);
    const end = vocalMashupGainsAt(plan, plan.totalSec);
    expect(end.out).toBeCloseTo(0);
    expect(end.vocal).toBeCloseTo(1);
    expect(end.inst).toBeCloseTo(1);
  });

  it("keeps the outgoing deck out of the vocal's way: it never gets louder, and the instrumental only appears in the hand-off", () => {
    const c = vocalMashupGainCurves(plan, 200);
    for (let i = 1; i < c.out.length; i++) expect(c.out[i]).toBeLessThanOrEqual(c.out[i - 1] + 1e-6);
    const holdIndex = Math.floor((plan.holdSec / plan.totalSec) * 199);
    for (let i = 0; i < holdIndex; i++) expect(c.inst[i]).toBe(0);
    expect(c.inst[199]).toBeCloseTo(1);
  });

  it("holds tempo and pitch at the match, then eases both home across the hand-off", () => {
    expect(vocalMashupTempoPitchAt(plan, 0)).toEqual({ tempo: plan.tempoRatio, pitchSemitones: plan.pitchSemitones });
    expect(vocalMashupTempoPitchAt(plan, plan.holdSec)).toEqual({ tempo: plan.tempoRatio, pitchSemitones: plan.pitchSemitones });
    const mid = vocalMashupTempoPitchAt(plan, plan.holdSec + plan.handoffSec / 2);
    expect(mid.tempo).toBeCloseTo((plan.tempoRatio + 1) / 2);
    expect(mid.pitchSemitones).toBeCloseTo(plan.pitchSemitones / 2);
    const end = vocalMashupTempoPitchAt(plan, plan.totalSec);
    expect(end.tempo).toBeCloseTo(1);
    expect(end.pitchSemitones).toBeCloseTo(0);
  });

  it("reports the phase", () => {
    expect(vocalMashupPhase(plan, 1)).toBe("holding");
    expect(vocalMashupPhase(plan, plan.holdSec + 1)).toBe("handoff");
  });
});

describe("instrumentalFromMixAndVocal", () => {
  it("removes the vocal from the mix, per channel", () => {
    const mix = [Float32Array.from([0.5, 0.25, -0.5]), Float32Array.from([0.1, 0.2, 0.3])];
    const vocal = [Float32Array.from([0.25, 0.25, -0.25]), Float32Array.from([0.1, 0.1, 0.1])];
    const inst = instrumentalFromMixAndVocal(mix, vocal);
    expect(Array.from(inst[0])).toEqual([0.25, 0, -0.25]);
    expect(inst[1][0]).toBeCloseTo(0);
    expect(inst[1][2]).toBeCloseTo(0.2);
  });

  it("subtracts a mono vocal from every channel and leaves the tail of a shorter vocal untouched", () => {
    const mix = [Float32Array.from([1, 1, 1, 1]), Float32Array.from([0.5, 0.5, 0.5, 0.5])];
    const inst = instrumentalFromMixAndVocal(mix, [Float32Array.from([0.5, 0.5])]);
    expect(Array.from(inst[0])).toEqual([0.5, 0.5, 1, 1]);
    expect(Array.from(inst[1])).toEqual([0, 0, 0.5, 0.5]);
  });

  it("clips instead of overflowing", () => {
    const inst = instrumentalFromMixAndVocal([Float32Array.from([0.9])], [Float32Array.from([-0.9])]);
    expect(inst[0][0]).toBe(1);
  });
});
