import { describe, expect, it } from "vitest";
import {
  HARD_BPM_GAP,
  keyRootSemitone,
  pickScratchSource,
  pitchShiftToKey,
  planScratchBridge,
  planScratchOverSong,
  SCRATCH_MIN_GAP_BARS,
  SCRATCH_SAMPLES,
  scratchGapBars,
  scratchNoteFor,
  scratchPattern,
  shouldScratchBridge,
  stretchRate,
  synthesizeScratchSample,
  type ScratchContext,
} from "./scratch";
import { barsToSec, isOnBeat } from "./djMoves";
import type { TrackAnalysis } from "./audio-analysis";

const BPM = 100;
const BEAT = 0.6;

function analysis(over: Partial<TrackAnalysis> = {}): TrackAnalysis {
  const peaks = Array.from({ length: 400 }, (_, i) => (i < 100 ? 0.15 : i < 200 ? 0.5 : 0.95));
  return { bpm: BPM, bpmConfidence: 0.9, beatGridOffsetSec: 0, energyOnsetSec: 0, key: "A minor", keyConfidence: 0.8, camelotKey: "8A", breakdownAtSec: null, dropAtSec: null, buildDropPairs: [], waveformPeaks: peaks, fallback: false, ...over };
}
const ctx = (over: Partial<ScratchContext> = {}): ScratchContext => ({ analysis: analysis(), durationSec: 240, currentTimeSec: 150, lastMoveAtSec: null, genre: "Hip-Hop", mode: "party", frequency: 1, volume: 0.7, ...over });

describe("the samples are made by the app", () => {
  it("are synthesised: deterministic, the right length, in range, and not silent", () => {
    for (const sample of SCRATCH_SAMPLES) {
      const a = synthesizeScratchSample(sample, 8000);
      const b = synthesizeScratchSample(sample, 8000);
      expect(a.length).toBe(Math.round(sample.lengthSec * 8000));
      expect(Array.from(a.slice(0, 200))).toEqual(Array.from(b.slice(0, 200)));
      let peak = 0;
      for (const v of a) peak = Math.max(peak, Math.abs(v));
      expect(peak, sample.id).toBeGreaterThan(0.05);
      expect(peak, sample.id).toBeLessThanOrEqual(1.5);
      expect(a.every(Number.isFinite)).toBe(true);
    }
  });
  it("each has a known length and base pitch", () => {
    for (const s of SCRATCH_SAMPLES) {
      expect(s.lengthSec).toBeGreaterThan(0);
      expect(s.baseSemitone).toBeGreaterThanOrEqual(0);
      expect(s.baseSemitone).toBeLessThan(12);
    }
  });
});

describe("fitting a hit to the song", () => {
  it("reads the tonic of a key and the shortest shift to it", () => {
    expect(keyRootSemitone("A minor")).toBe(9);
    expect(keyRootSemitone("F# major")).toBe(6);
    expect(keyRootSemitone("Bb major")).toBe(10);
    expect(keyRootSemitone(null)).toBeNull();
    expect(pitchShiftToKey(0, "A minor")).toBe(-3); // the nearest way round: down 3, not up 9
    expect(pitchShiftToKey(0, "G major")).toBe(-5);
    expect(pitchShiftToKey(0, "F# major")).toBe(6);
    expect(pitchShiftToKey(0, null)).toBe(0);
    for (let root = 0; root < 12; root++) expect(Math.abs(pitchShiftToKey(0, ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][root] + " major"))).toBeLessThanOrEqual(6);
  });
  it("stretches a sample to fill its note at the song's tempo", () => {
    expect(stretchRate(0.5, 1, 100)).toBeCloseTo(0.5 / BEAT, 6); // half a second into one beat of 0.6 s: slower
    expect(stretchRate(0.5, 0.5, 100)).toBeCloseTo(0.5 / (BEAT / 2), 6);
    expect(stretchRate(0.5, 1, 0)).toBeGreaterThan(0);
  });
  it("quantises a pattern to the grid: one hit per note, back to back, alternating direction, pitched to the key", () => {
    const hits = scratchPattern({ startSec: 12, bpm: BPM, note: "1/8", sample: SCRATCH_SAMPLES[0], songKey: "A minor" });
    expect(hits).toHaveLength(8); // one bar of eighth notes
    expect(hits[0].atSec).toBe(12);
    expect(hits[1].atSec).toBeCloseTo(12 + BEAT / 2, 9);
    expect(hits.map((h) => h.direction).slice(0, 4)).toEqual(["forward", "back", "forward", "back"]);
    expect(hits.every((h) => h.detuneCents === -300)).toBe(true);
    expect(hits.every((h) => h.rate === hits[0].rate)).toBe(true);
    expect(scratchPattern({ startSec: 0, bpm: BPM, note: "1/4", sample: SCRATCH_SAMPLES[0], songKey: null })).toHaveLength(4);
    expect(scratchPattern({ startSec: 0, bpm: BPM, note: "1/16", sample: SCRATCH_SAMPLES[0], songKey: null })).toHaveLength(16);
  });
  it("chooses the busier pattern for a harder occasion", () => {
    expect(scratchNoteFor(1)).toBe("1/16");
    expect(scratchNoteFor(0.6)).toBe("1/8");
    expect(scratchNoteFor(0.3)).toBe("1/4");
  });
});

describe("planScratchOverSong", () => {
  it("scratches at the next phrase in hip-hop at a party, quantised to the grid", () => {
    const a = analysis();
    const m = planScratchOverSong(ctx({ analysis: a, currentTimeSec: 150 }))!;
    expect(isOnBeat(a, m.startSec)).toBe(true);
    expect(m.hits[0].atSec).toBe(m.startSec);
    expect(m.note).toBe("1/16");
    expect(m.source).toBe("sample");
    expect(m.volume).toBe(0.7);
    expect(m.reason).toMatch(/energy .*, 100 BPM, 1\/16 scratch at the phrase in \d+ bars/);
  });
  it("uses a stem of the song when one is ready", () => {
    expect(planScratchOverSong(ctx({ stems: { vocals: true } }))!.source).toBe("vocal-stem");
    expect(planScratchOverSong(ctx({ stems: { drums: true } }))!.source).toBe("drum-stem");
    expect(pickScratchSource(undefined)).toBe("sample");
  });
  it("only for the genres and occasions that suit it", () => {
    expect(planScratchOverSong(ctx({ genre: "Country" }))).toBeNull();
    expect(planScratchOverSong(ctx({ mode: "wedding" }))).toBeNull();
    expect(planScratchOverSong(ctx({ genre: "Electronic", mode: "club" }))).not.toBeNull();
  });
  it("needs the energy, a usable tempo, and the phrase to be about to begin", () => {
    expect(planScratchOverSong(ctx({ currentTimeSec: 10 }))).toBeNull();
    expect(planScratchOverSong(ctx({ analysis: analysis({ fallback: true }) }))).toBeNull();
    expect(planScratchOverSong(ctx({ analysis: analysis({ bpm: 50 }) }))).toBeNull();
    // phrases are 8 bars = 19.2 s apart at 100 BPM: 11 s from the next one is too far to plan
    expect(planScratchOverSong(ctx({ currentTimeSec: 143.5 }))).toBeNull();
  });
  it("is rate-limited by the frequency setting", () => {
    const sixteen = barsToSec(SCRATCH_MIN_GAP_BARS, BPM);
    expect(planScratchOverSong(ctx({ lastMoveAtSec: 150 - sixteen + 1 }))).toBeNull();
    expect(planScratchOverSong(ctx({ lastMoveAtSec: 150 - sixteen }))).not.toBeNull();
    expect(scratchGapBars(1, "Hip-Hop")).toBe(16);
    expect(scratchGapBars(0, "Hip-Hop")).toBe(64);
  });
  it("is never random", () => {
    const first = planScratchOverSong(ctx());
    for (let i = 0; i < 20; i++) expect(planScratchOverSong(ctx())).toEqual(first);
  });
});

describe("shouldScratchBridge: a hard match", () => {
  const easy = { bpmDelta: 3, tempoConfident: true, keyCompatibility: "perfect" as const, keyConfident: true, morphPitchShiftSemitones: 0, suggestedPitchShiftSemitones: 0 };
  it("bridges a large tempo gap, a key clash, or a pitch shift above four semitones", () => {
    expect(shouldScratchBridge({ ...easy, bpmDelta: HARD_BPM_GAP + 1 })).toEqual({ use: true, reason: "tempo gap of 13 BPM" });
    expect(shouldScratchBridge({ ...easy, keyCompatibility: "clash" })).toEqual({ use: true, reason: "the keys clash" });
    expect(shouldScratchBridge({ ...easy, morphPitchShiftSemitones: -5 }).use).toBe(true);
    expect(shouldScratchBridge({ ...easy, suggestedPitchShiftSemitones: 6 }).reason).toMatch(/6 semitones/);
  });
  it("leaves an easy pair to the normal transition", () => {
    expect(shouldScratchBridge(easy)).toEqual({ use: false, reason: "the pair mixes cleanly" });
    expect(shouldScratchBridge({ ...easy, bpmDelta: HARD_BPM_GAP })).toMatchObject({ use: false });
    expect(shouldScratchBridge({ ...easy, morphPitchShiftSemitones: 4 })).toMatchObject({ use: false });
  });
  it("does not judge a pair on readings it cannot trust", () => {
    expect(shouldScratchBridge({ ...easy, bpmDelta: 40, tempoConfident: false }).use).toBe(false);
    expect(shouldScratchBridge({ ...easy, keyCompatibility: "clash", keyConfident: false }).use).toBe(false);
  });
});

describe("planScratchBridge", () => {
  it("starts on the outgoing song's next bar line, in its key, one bar long", () => {
    const a = analysis({ beatGridOffsetSec: 0.3 });
    const m = planScratchBridge({ outgoing: a, currentTimeSec: 100, mode: "club", volume: 0.5, reason: "tempo gap of 20 BPM" })!;
    expect(isOnBeat(a, m.startSec)).toBe(true);
    expect(m.startSec).toBeGreaterThanOrEqual(100);
    expect(m.startSec - 100).toBeLessThan(4 * BEAT + 1e-6);
    expect(m.hits.every((h) => h.detuneCents === -300)).toBe(true);
    expect(m.reason).toBe("scratch bridge (tempo gap of 20 BPM)");
  });
  it("says null when the outgoing song has no usable grid", () => {
    expect(planScratchBridge({ outgoing: analysis({ fallback: true }), currentTimeSec: 10, volume: 0.5, reason: "x" })).toBeNull();
  });
});
