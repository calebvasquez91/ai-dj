/**
 * Pure sample-array reversal for Reverse Playback / the "Reverse Tail"
 * transition (DualDeckStage.tsx) — pulled out as its own tiny, easily
 * unit-tested function since it's the one piece of real new audio-buffer
 * manipulation those effects need (everything else about them is Web Audio
 * node wiring, which needs a real AudioContext to exercise).
 */
export function reverseSamples(samples: Float32Array<ArrayBufferLike>): Float32Array<ArrayBuffer> {
  const reversed = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    reversed[i] = samples[samples.length - 1 - i];
  }
  return reversed;
}
