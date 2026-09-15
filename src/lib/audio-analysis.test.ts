import { describe, expect, it } from "vitest";
import { analyzeSamples, camelotForKey } from "./audio-analysis";

const SAMPLE_RATE = 11025;

function buildClickTrack(bpm: number, durationSec: number, sampleRate = SAMPLE_RATE): Float32Array {
  const n = Math.floor(durationSec * sampleRate);
  const samples = new Float32Array(n);
  const beatLenSec = 60 / bpm;
  const clickDurSec = 0.05;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const beatPos = t % beatLenSec;
    if (beatPos < clickDurSec) {
      const decay = Math.exp(-beatPos / (clickDurSec / 4));
      samples[i] = decay * Math.sin(2 * Math.PI * 150 * t) * 0.9;
    } else {
      samples[i] = (Math.random() - 0.5) * 0.01;
    }
  }
  return samples;
}

function isTempoMatch(estimatedBpm: number, targetBpm: number, toleranceBpm = 4): boolean {
  return [targetBpm, targetBpm * 2, targetBpm / 2].some(
    (t) => Math.abs(estimatedBpm - t) <= toleranceBpm
  );
}

describe("analyzeSamples", () => {
  it("recovers the tempo of a steady 128 BPM click track (within octave ambiguity)", () => {
    const samples = buildClickTrack(128, 20);
    const analysis = analyzeSamples(samples, SAMPLE_RATE, 20);
    expect(analysis.fallback).toBe(false);
    expect(isTempoMatch(analysis.bpm, 128)).toBe(true);
  });

  it("recovers the tempo of a steady 90 BPM click track (within octave ambiguity)", () => {
    const samples = buildClickTrack(90, 20);
    const analysis = analyzeSamples(samples, SAMPLE_RATE, 20);
    expect(analysis.fallback).toBe(false);
    expect(isTempoMatch(analysis.bpm, 90)).toBe(true);
  });

  it("finds an energy onset after a silent intro, not at the literal start", () => {
    const introSec = 5;
    const grooveSec = 15;
    const intro = new Float32Array(Math.floor(introSec * SAMPLE_RATE)).map(
      () => (Math.random() - 0.5) * 0.005
    );
    const groove = buildClickTrack(128, grooveSec);
    const samples = new Float32Array(intro.length + groove.length);
    samples.set(intro, 0);
    samples.set(groove, intro.length);

    const analysis = analyzeSamples(samples, SAMPLE_RATE, introSec + grooveSec);
    expect(analysis.energyOnsetSec).toBeGreaterThan(2);
    expect(analysis.energyOnsetSec).toBeLessThan(introSec + 3);
  });

  it("falls back to a neutral BPM with low confidence for pure noise (no periodicity)", () => {
    const durationSec = 10;
    const samples = new Float32Array(Math.floor(durationSec * SAMPLE_RATE)).map(
      () => (Math.random() - 0.5) * 0.1
    );
    const analysis = analyzeSamples(samples, SAMPLE_RATE, durationSec);
    expect(analysis.fallback).toBe(true);
    expect(analysis.bpm).toBe(120);
    expect(analysis.bpmConfidence).toBeLessThan(0.15);
  });

  it("returns a non-negative, finite beat grid offset", () => {
    const samples = buildClickTrack(140, 15);
    const analysis = analyzeSamples(samples, SAMPLE_RATE, 15);
    expect(Number.isFinite(analysis.beatGridOffsetSec)).toBe(true);
    expect(analysis.beatGridOffsetSec).toBeGreaterThanOrEqual(0);
  });

  it("produces a normalized waveform peak array suitable for rendering", () => {
    const samples = buildClickTrack(128, 20);
    const analysis = analyzeSamples(samples, SAMPLE_RATE, 20);
    expect(analysis.waveformPeaks.length).toBe(240);
    expect(Math.max(...analysis.waveformPeaks)).toBeCloseTo(1, 5);
    expect(Math.min(...analysis.waveformPeaks)).toBeGreaterThanOrEqual(0);
  });

  it("finds a drop (loudest plateau) inside a louder section and a breakdown inside a quieter one", () => {
    const bpm = 128;
    const intro = new Float32Array(Math.floor(3 * SAMPLE_RATE)).map(() => (Math.random() - 0.5) * 0.005);
    const groove1 = buildClickTrack(bpm, 6);
    const drop = buildClickTrack(bpm, 6).map((v) => v * 2.2);
    const breakdown = new Float32Array(Math.floor(4 * SAMPLE_RATE)).map(() => (Math.random() - 0.5) * 0.004);
    const groove2 = buildClickTrack(bpm, 6);
    const parts = [intro, groove1, drop, breakdown, groove2];
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const p of parts) {
      samples.set(p, offset);
      offset += p.length;
    }
    const durationSec = total / SAMPLE_RATE;
    const analysis = analyzeSamples(samples, SAMPLE_RATE, durationSec);

    const dropSectionStart = 3 + 6;
    const dropSectionEnd = dropSectionStart + 6;
    expect(analysis.dropAtSec).not.toBeNull();
    expect(analysis.dropAtSec as number).toBeGreaterThanOrEqual(dropSectionStart);
    expect(analysis.dropAtSec as number).toBeLessThan(dropSectionEnd);

    const breakdownSectionStart = dropSectionEnd;
    const breakdownSectionEnd = breakdownSectionStart + 4;
    expect(analysis.breakdownAtSec).not.toBeNull();
    expect(analysis.breakdownAtSec as number).toBeGreaterThanOrEqual(breakdownSectionStart);
    expect(analysis.breakdownAtSec as number).toBeLessThan(breakdownSectionEnd);
  });

  it("finds two ordered build/drop pairs in a track with two build-drop cycles", () => {
    const bpm = 128;
    const rampUp = (samples: Float32Array) =>
      samples.map((v, i) => v * (0.15 + 0.85 * (i / samples.length)));

    const intro = new Float32Array(Math.floor(3 * SAMPLE_RATE)).map(() => (Math.random() - 0.5) * 0.005);
    const build1 = rampUp(buildClickTrack(bpm, 8));
    const drop1 = buildClickTrack(bpm, 6).map((v) => v * 2.2);
    const breakdown = new Float32Array(Math.floor(4 * SAMPLE_RATE)).map(() => (Math.random() - 0.5) * 0.004);
    const build2 = rampUp(buildClickTrack(bpm, 8));
    const drop2 = buildClickTrack(bpm, 6).map((v) => v * 2.2);
    const outro = new Float32Array(Math.floor(3 * SAMPLE_RATE)).map(() => (Math.random() - 0.5) * 0.005);

    const parts = [intro, build1, drop1, breakdown, build2, drop2, outro];
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const p of parts) {
      samples.set(p, offset);
      offset += p.length;
    }
    const durationSec = total / SAMPLE_RATE;
    const analysis = analyzeSamples(samples, SAMPLE_RATE, durationSec);

    // Generous ±1.5s slack around each section boundary: the detector runs
    // on a 1s-smoothed envelope, so a transition can blur across it by
    // design — these boundaries were never meant to be frame-exact, only
    // "clearly in the right section."
    const slack = 1.5;
    const build1Start = 3;
    const build1End = build1Start + 8;
    const drop1Start = build1End;
    const drop1End = drop1Start + 6;
    const build2Start = drop1End + 4;
    const build2End = build2Start + 8;
    const drop2Start = build2End;
    const drop2End = drop2Start + 6;

    expect(analysis.buildDropPairs).toHaveLength(2);
    const [pair1, pair2] = analysis.buildDropPairs;
    expect(pair1.buildAtSec).toBeGreaterThanOrEqual(build1Start - slack);
    expect(pair1.buildAtSec).toBeLessThan(build1End + slack);
    expect(pair1.dropAtSec).toBeGreaterThanOrEqual(drop1Start - slack);
    expect(pair1.dropAtSec).toBeLessThan(drop1End + slack);
    expect(pair2.buildAtSec).toBeGreaterThanOrEqual(build2Start - slack);
    expect(pair2.buildAtSec).toBeLessThan(build2End + slack);
    expect(pair2.dropAtSec).toBeGreaterThanOrEqual(drop2Start - slack);
    expect(pair2.dropAtSec).toBeLessThan(drop2End + slack);
    expect(pair1.dropAtSec).toBeLessThan(pair2.buildAtSec);
  });

  it("finds only one build/drop pair in a track with a single build-drop cycle", () => {
    const bpm = 128;
    const rampUp = (samples: Float32Array) =>
      samples.map((v, i) => v * (0.15 + 0.85 * (i / samples.length)));
    const intro = new Float32Array(Math.floor(3 * SAMPLE_RATE)).map(() => (Math.random() - 0.5) * 0.005);
    const build = rampUp(buildClickTrack(bpm, 8));
    const drop = buildClickTrack(bpm, 10).map((v) => v * 2.2);
    const parts = [intro, build, drop];
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const p of parts) {
      samples.set(p, offset);
      offset += p.length;
    }
    const analysis = analyzeSamples(samples, SAMPLE_RATE, total / SAMPLE_RATE);
    expect(analysis.buildDropPairs).toHaveLength(1);
  });

  it("finds no build/drop pairs in a flat, structureless track", () => {
    const samples = buildClickTrack(128, 20);
    const analysis = analyzeSamples(samples, SAMPLE_RATE, 20);
    expect(analysis.buildDropPairs).toEqual([]);
  });
});

describe("camelotForKey", () => {
  it("maps well-known major/minor keys to their standard Camelot codes", () => {
    expect(camelotForKey("C major")).toBe("8B");
    expect(camelotForKey("A minor")).toBe("8A");
    expect(camelotForKey("G major")).toBe("9B");
    expect(camelotForKey("E minor")).toBe("9A");
    expect(camelotForKey("D major")).toBe("10B");
    expect(camelotForKey("B minor")).toBe("10A");
  });

  it("returns null for an unknown key or no key", () => {
    expect(camelotForKey(null)).toBeNull();
    expect(camelotForKey("not a key")).toBeNull();
  });
});
