import { describe, expect, it } from "vitest";
import { playScratch, type ScratchContextLike } from "./scratchAudio";
import { planScratchOverSong, type ScratchContext } from "./scratch";
import type { TrackAnalysis } from "./audio-analysis";

function fakeContext(now = 10) {
  const starts: { at: number; stop: number; rate: number; detune: number; reversed: boolean }[] = [];
  const buffers: Float32Array[] = [];
  const ctx: ScratchContextLike = {
    sampleRate: 8000,
    currentTime: now,
    createBuffer: (_c, length) => {
      const data = new Float32Array(length);
      buffers.push(data);
      return { getChannelData: () => data };
    },
    createBufferSource: () => {
      const src = { buffer: null as unknown, playbackRate: { value: 1 }, detune: { value: 0 }, connect: () => undefined, start: (at = 0) => void rec.push({ at }), stop: (at = 0) => void (rec.at(-1)!.stop = at) };
      const rec: { at: number; stop?: number }[] = [];
      return {
        ...src,
        start(at = 0) {
          starts.push({ at, stop: 0, rate: this.playbackRate.value, detune: this.detune.value, reversed: this.buffer === buffers[1] });
        },
        stop(at = 0) {
          starts[starts.length - 1].stop = at;
        },
      };
    },
    createGain: () => ({ gain: { value: 0, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined }, connect: () => undefined }),
  };
  return { ctx, starts, buffers };
}

function move() {
  const peaks = Array.from({ length: 400 }, (_, i) => (i < 100 ? 0.15 : i < 200 ? 0.5 : 0.95));
  const analysis: TrackAnalysis = { bpm: 100, bpmConfidence: 1, beatGridOffsetSec: 0, energyOnsetSec: 0, key: "A minor", keyConfidence: 1, camelotKey: "8A", breakdownAtSec: null, dropAtSec: null, buildDropPairs: [], waveformPeaks: peaks, fallback: false };
  const ctx: ScratchContext = { analysis, durationSec: 240, currentTimeSec: 150, lastMoveAtSec: null, genre: "Hip-Hop", mode: "party", frequency: 1, volume: 0.7 };
  return planScratchOverSong(ctx)!;
}

describe("playScratch", () => {
  it("starts one source per hit at its place in the pattern, on the audio clock", () => {
    const { ctx, starts } = fakeContext(10);
    const m = move();
    const { endsAt } = playScratch(ctx, {}, m, 20);
    expect(starts).toHaveLength(m.hits.length);
    expect(starts[0].at).toBe(20);
    expect(starts[1].at).toBeCloseTo(20 + (m.hits[1].atSec - m.hits[0].atSec), 9);
    expect(endsAt).toBeCloseTo(20 + 2.4, 6); // one bar of four 0.6 s beats
  });
  it("stretches and detunes each hit as planned, and alternates forward and reversed", () => {
    const { ctx, starts } = fakeContext();
    const m = move();
    playScratch(ctx, {}, m, 20);
    expect(starts.every((s) => s.rate === m.hits[0].rate && s.detune === -300)).toBe(true);
    expect(starts[0].reversed).toBe(false);
  });
  it("never starts a hit in the past", () => {
    const { ctx, starts } = fakeContext(50);
    playScratch(ctx, {}, move(), 20);
    expect(starts.every((s) => s.at >= 50)).toBe(true);
  });
  it("makes each sample once per context and reuses it", () => {
    const { ctx, buffers } = fakeContext();
    playScratch(ctx, {}, move(), 20);
    const made = buffers.length;
    playScratch(ctx, {}, move(), 30);
    expect(buffers.length).toBe(made);
    expect(made).toBe(2); // forward and reversed
  });
  it("says it played the recorded sample, even when a stem was planned (a stem needs a decoded buffer the deck does not hold)", () => {
    const { ctx } = fakeContext();
    expect(playScratch(ctx, {}, { ...move(), source: "vocal-stem" }, 20).source).toBe("sample");
  });
});
