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
