// Plays a planned scratch (lib/scratch.ts) with Web Audio: each hit is the synthesised sample, forward or reversed, stretched to its note and
// detuned to the key, started at an exact audio-clock time so it is locked to the beat grid. The sample buffers are made once and kept. A scratch
// that a stem of the song was planned for plays the recorded sample for now: scratching a stem needs a decoded buffer of it, which the deck does
// not hold, so `play` says which source it actually used.
import { SCRATCH_SAMPLES, synthesizeScratchSample, type ScratchMove, type ScratchSample, type ScratchSource } from "@/lib/scratch";

/** The few Web Audio calls this needs (a real AudioContext fits; the tests use a recorder). */
export interface ScratchContextLike {
  sampleRate: number;
  currentTime: number;
  createBuffer(channels: number, length: number, sampleRate: number): { getChannelData(channel: number): Float32Array };
  createBufferSource(): {
    buffer: unknown;
    playbackRate: { value: number };
    detune: { value: number };
    connect(node: unknown): unknown;
    start(when?: number): void;
    stop(when?: number): void;
  };
  createGain(): {
    gain: { value: number; setValueAtTime(v: number, t: number): unknown; linearRampToValueAtTime(v: number, t: number): unknown };
    connect(node: unknown): unknown;
  };
}

type Buffers = Map<string, { forward: unknown; back: unknown }>;
const cache = new WeakMap<object, Buffers>();

function buffersFor(ctx: ScratchContextLike, sample: ScratchSample) {
  let all = cache.get(ctx);
  if (!all) cache.set(ctx, (all = new Map()));
  let entry = all.get(sample.id);
  if (!entry) {
    const data = synthesizeScratchSample(sample, ctx.sampleRate);
    const make = (samples: Float32Array) => {
      const b = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      b.getChannelData(0).set(samples);
      return b;
    };
    entry = { forward: make(data), back: make(Float32Array.from(data).reverse()) };
    all.set(sample.id, entry);
  }
  return entry;
}

/**
 * Schedules every hit of the move. `startCtxTime` is the audio-clock time of the move's start (the caller converts it from the song position);
 * a hit never starts before now. Returns the source actually played, and when the last hit ends.
 */
export function playScratch(ctx: ScratchContextLike, destination: unknown, move: ScratchMove, startCtxTime: number): { source: ScratchSource; endsAt: number } {
  const sample = SCRATCH_SAMPLES.find((s) => s.id === move.sample.id) ?? SCRATCH_SAMPLES[0];
  const buffers = buffersFor(ctx, sample);
  const origin = move.hits[0]?.atSec ?? move.startSec;
  let endsAt = startCtxTime;
  for (const hit of move.hits) {
    const at = Math.max(ctx.currentTime, startCtxTime + (hit.atSec - origin));
    const source = ctx.createBufferSource();
    source.buffer = hit.direction === "forward" ? buffers.forward : buffers.back;
    source.playbackRate.value = hit.rate;
    source.detune.value = hit.detuneCents;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(move.volume, at + 0.004);
    gain.gain.setValueAtTime(move.volume, at + hit.lengthSec - 0.01);
    gain.gain.linearRampToValueAtTime(0, at + hit.lengthSec);
    source.connect(gain);
    gain.connect(destination);
    source.start(at);
    source.stop(at + hit.lengthSec);
    endsAt = Math.max(endsAt, at + hit.lengthSec);
  }
  return { source: "sample", endsAt };
}
