/**
 * soundtouchjs ships no TypeScript types — this declares only the surface
 * actually used by src/lib/time-stretch.ts (the PitchShifter wrapper
 * class). See node_modules/soundtouchjs/dist/soundtouch.js for the real
 * implementation if this ever needs to grow.
 */
declare module "soundtouchjs" {
  export class PitchShifter {
    constructor(context: AudioContext, buffer: AudioBuffer, bufferSize: number, onEnd?: () => void);
    tempo: number;
    pitch: number;
    pitchSemitones: number;
    /**
     * Quirk in the library itself: the getter returns a 0-100 percentage,
     * but the setter treats its input as a 0-1 fraction (it multiplies by
     * duration*sampleRate directly, with no /100). Only ever *set* this,
     * as a 0-1 fraction.
     */
    percentagePlayed: number;
    readonly node: AudioNode;
    readonly duration: number;
    connect(node: AudioNode): void;
    disconnect(): void;
    on(eventName: string, cb: (detail: unknown) => void): void;
    off(eventName?: string): void;
  }
}
