import { describe, expect, it } from "vitest";
import { analyzeSamples } from "./audio-analysis";

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
});
