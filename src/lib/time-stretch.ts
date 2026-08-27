/**
 * Thin wrapper around SoundTouchJS's PitchShifter, isolating the third-
 * party time-stretch/pitch-shift dependency behind a small interface — the
 * same way audio-analysis.ts isolates its WASM/worker fast paths behind
 * analyzeTrackFromUrl(). Only the mashup pathway in DualDeckStage.tsx
 * should import this.
 *
 * SoundTouchJS runs a WSOLA algorithm via a ScriptProcessorNode
 * (deprecated but functional in every browser) — real, non-trivial
 * main-thread CPU cost while a voice is active, and mild "warble/
 * phasiness" artifacts on a full mix that get more noticeable the further
 * the tempo ratio or pitch shift strays from 1x/0 semitones. That's an
 * accepted tradeoff for an occasional mashup highlight, not a claim of
 * studio-transparent quality.
 */

import { PitchShifter } from "soundtouchjs";

const BUFFER_SIZE = 1024;

export interface TimeStretchVoice {
  /** Connect this into the rest of a Web Audio graph — SoundTouchJS's PitchShifter is a "pseudo-node": it can be connected to a destination, but nothing can connect into it. */
  node: AudioNode;
  setTempo(tempo: number): void;
  setPitchSemitones(semitones: number): void;
  /** Seeks to a fractional position (0-1) within the source buffer before/while playing. */
  setStartFraction(fraction: number): void;
  /** Releases listeners and disconnects the node — call once the voice is done playing. */
  stop(): void;
}

export interface TimeStretchOptions {
  /** Playback speed ratio relative to the buffer's native tempo (1 = unchanged). */
  tempo: number;
  /** Pitch shift in semitones, independent of tempo (0 = unchanged). */
  pitchSemitones: number;
  /** Fires once the buffer finishes playing on its own (not called by stop()). */
  onEnd?: () => void;
}

/** Wraps a decoded AudioBuffer in a tempo/pitch-independent playback voice. */
export function createTimeStretchVoice(
  ctx: AudioContext,
  buffer: AudioBuffer,
  { tempo, pitchSemitones, onEnd }: TimeStretchOptions
): TimeStretchVoice {
  const shifter = new PitchShifter(ctx, buffer, BUFFER_SIZE, onEnd);
  shifter.tempo = tempo;
  shifter.pitchSemitones = pitchSemitones;

  return {
    node: shifter.node,
    setTempo: (t) => {
      shifter.tempo = t;
    },
    setPitchSemitones: (s) => {
      shifter.pitchSemitones = s;
    },
    setStartFraction: (fraction) => {
      shifter.percentagePlayed = fraction;
    },
    stop: () => {
      shifter.off();
      shifter.disconnect();
    },
  };
}
