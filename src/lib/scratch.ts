// Scratching (behind SCRATCH_ENABLED). Two uses: a scratch pattern over a song at a suitable moment (hip-hop, rap and electronic, when the energy is
// there), and a scratch as the bridge between two songs that do not mix cleanly (a large tempo gap, a key clash, or a pitch shift of more than four
// semitones) instead of a long morph. Every scratch is quantised to the beat grid with a pattern of 1/4, 1/8 or 1/16 notes, each hit
// time-stretched to fit its note at the song's tempo and pitched to the song's key. Never random: the same moment plans the same scratch.
//
// Sources. The recorded samples are SYNTHESISED here (see synthesizeScratchSample: filtered noise with a back-and-forth pitch sweep), so there is
// no third-party recording and nothing to license or credit beyond this file. The other source is a stem of the playing song (its vocal or its
// drums) when stems are ready; planning treats both the same (a source and a base length), the engine decides which it can play. Pure.
import type { TrackAnalysis } from "@/lib/audio-analysis";
import type { DjSetMode } from "@/lib/mix-engine";
import { barsToSec, barsUntil, beatLengthSec, energyAt, gapElapsed, genreMoveWeight, modeIntensity, nextBoundary } from "@/lib/djMoves";
import type { SyncReport } from "@/lib/syncEngine";

export type ScratchNote = "1/4" | "1/8" | "1/16";
const NOTE_BEATS: Record<ScratchNote, number> = { "1/4": 1, "1/8": 0.5, "1/16": 0.25 };

/** The shortest gap between two scratches over a song, in bars; the frequency setting stretches it. */
export const SCRATCH_MIN_GAP_BARS = 16;
export const SCRATCH_MAX_GAP_BARS = 64;
/** The song must be at least this energetic (0-1) for a scratch over it. */
export const SCRATCH_MIN_ENERGY = 0.5;
export const SCRATCH_BPM_RANGE = { min: 70, max: 180 } as const;
/** A scratch pattern is one bar long. */
export const SCRATCH_PATTERN_BARS = 1;

// ---- The samples --------------------------------------------------------------------------------------------------------------------

export interface ScratchSample {
  id: "baby" | "chirp" | "transform";
  label: string;
  /** How long the sample is at its natural speed, seconds. */
  lengthSec: number;
  /** The note it sounds at its natural speed, in semitones above C (0-11). */
  baseSemitone: number;
}

/** The samples the app makes itself, each with the length and pitch it is recorded at. */
export const SCRATCH_SAMPLES: readonly ScratchSample[] = [
  { id: "baby", label: "Baby scratch", lengthSec: 0.5, baseSemitone: 0 },
  { id: "chirp", label: "Chirp", lengthSec: 0.25, baseSemitone: 0 },
  { id: "transform", label: "Transform", lengthSec: 0.5, baseSemitone: 0 },
];

/** A small deterministic noise source, so a sample is the same every time. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x80000000 - 1;
  };
}

/**
 * Makes a scratch sample: noise shaped by a record being pushed forward and pulled back (a pitched, filtered buzz whose rate follows a
 * back-and-forth curve), with a quick attack and release. Mono, deterministic, at the sample's own length.
 */
export function synthesizeScratchSample(sample: ScratchSample, sampleRate: number): Float32Array {
  const frames = Math.max(1, Math.round(sample.lengthSec * sampleRate));
  const out = new Float32Array(frames);
  const rand = noise(sample.id.length * 7919 + frames);
  const root = 110 * 2 ** (sample.baseSemitone / 12);
  let phase = 0;
  let lowpass = 0;
  for (let i = 0; i < frames; i++) {
    const t = i / frames; // 0..1 through the sample
    // the record moves forward then back: a speed that swings from fast to a standstill to reverse-fast
    const speed = sample.id === "chirp" ? 1 - t : sample.id === "transform" ? (Math.floor(t * 8) % 2 === 0 ? 1 : 0.05) : Math.cos(t * Math.PI * 2);
    phase += (root * (2 + 6 * Math.abs(speed))) / sampleRate;
    const tone = Math.sign(Math.sin(phase * Math.PI * 2)) * 0.5;
    lowpass += 0.25 * (rand() * 0.6 + tone - lowpass);
    const attack = Math.min(1, i / (0.004 * sampleRate));
    const release = Math.min(1, (frames - i) / (0.02 * sampleRate));
    out[i] = lowpass * attack * release * Math.min(1, 0.4 + Math.abs(speed));
  }
  return out;
}

// ---- Fitting a hit to the song ------------------------------------------------------------------------------------------------------

const SEMITONES_BY_NOTE: Record<string, number> = { c: 0, "c#": 1, db: 1, d: 2, "d#": 3, eb: 3, e: 4, f: 5, "f#": 6, gb: 6, g: 7, "g#": 8, ab: 8, a: 9, "a#": 10, bb: 10, b: 11 };

/** The tonic of a key label such as "A minor" or "F# major", in semitones above C, or null when it is not a key. */
export function keyRootSemitone(key: string | null | undefined): number | null {
  const m = /^([A-Ga-g][#b]?)\s/.exec(`${key ?? ""} `);
  return m ? (SEMITONES_BY_NOTE[m[1].toLowerCase()] ?? null) : null;
}

/** The shift in semitones (-6..+6, the nearest way round) that takes a sample recorded at `baseSemitone` to the song's key. 0 when the song's key is not known. */
export function pitchShiftToKey(baseSemitone: number, songKey: string | null | undefined): number {
  const root = keyRootSemitone(songKey);
  if (root == null) return 0;
  const s = (((root - baseSemitone) % 12) + 12) % 12;
  return s > 6 ? s - 12 : s;
}

/** The playback rate that makes a sample of `lengthSec` exactly fill `noteBeats` beats at this tempo (below 1 stretches it out, above 1 squeezes it in). */
export function stretchRate(lengthSec: number, noteBeats: number, bpm: number): number {
  const target = noteBeats * beatLengthSec(bpm);
  return target > 0 ? lengthSec / target : 1;
}

export interface ScratchHit {
  /** When the hit starts, seconds into the song, on the grid. */
  atSec: number;
  /** Which way the record moves: forward for the first half of the hit and back for the rest, alternating. */
  direction: "forward" | "back";
  /** Playback rate to fit the note (tempo stretch). */
  rate: number;
  /** Cents to detune by to land in the song's key. */
  detuneCents: number;
  lengthSec: number;
}

/** The hits of a one-bar pattern of `note` notes starting at `startSec`: one per note, back to back, alternating direction. */
export function scratchPattern(args: { startSec: number; bpm: number; note: ScratchNote; sample: ScratchSample; songKey: string | null | undefined; bars?: number }): ScratchHit[] {
  const { startSec, bpm, note, sample, songKey } = args;
  const beats = NOTE_BEATS[note];
  const count = Math.round(((args.bars ?? SCRATCH_PATTERN_BARS) * 4) / beats);
  const rate = stretchRate(sample.lengthSec, beats, bpm);
  const cents = pitchShiftToKey(sample.baseSemitone, songKey) * 100;
  return Array.from({ length: count }, (_, i) => ({
    atSec: startSec + i * beats * beatLengthSec(bpm),
    direction: i % 2 === 0 ? "forward" : "back",
    rate,
    detuneCents: cents,
    lengthSec: beats * beatLengthSec(bpm),
  }));
}

/** The finest note the occasion and genre allow: a harder one chooses the busier pattern. */
export function scratchNoteFor(intensity: number): ScratchNote {
  return intensity >= 0.8 ? "1/16" : intensity >= 0.5 ? "1/8" : "1/4";
}

// ---- Over a song --------------------------------------------------------------------------------------------------------------------

export type ScratchSource = "sample" | "vocal-stem" | "drum-stem";

export interface ScratchMove {
  startSec: number;
  note: ScratchNote;
  source: ScratchSource;
  sample: ScratchSample;
  hits: ScratchHit[];
  /** 0-1 from the settings. */
  volume: number;
  reason: string;
}

export interface ScratchContext {
  analysis: TrackAnalysis;
  durationSec: number;
  currentTimeSec: number;
  lastMoveAtSec: number | null;
  genre?: string | null;
  mode?: DjSetMode | null;
  /** 0 (rarely) to 1 (as often as the rules allow). */
  frequency: number;
  volume: number;
  /** Which stems of the playing song are ready. */
  stems?: { vocals?: boolean; drums?: boolean };
}

export function scratchGapBars(frequency: number, genre: string | null | undefined): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(frequency) ? frequency : 0.5));
  return Math.round((SCRATCH_MIN_GAP_BARS + (1 - f) * (SCRATCH_MAX_GAP_BARS - SCRATCH_MIN_GAP_BARS)) / genreMoveWeight(genre));
}

/** A stem of the song when one is ready (its vocal first, then its drums), else a recorded sample. */
export function pickScratchSource(stems: ScratchContext["stems"]): ScratchSource {
  return stems?.vocals ? "vocal-stem" : stems?.drums ? "drum-stem" : "sample";
}

/** A scratch over the playing song at a suitable moment, or null. Only for the genres and occasions that suit it, with the energy there, on a phrase boundary, and rate-limited. */
export function planScratchOverSong(ctx: ScratchContext): ScratchMove | null {
  const { analysis, durationSec, currentTimeSec: now } = ctx;
  const bpm = analysis.bpm;
  if (analysis.fallback || !(bpm >= SCRATCH_BPM_RANGE.min && bpm <= SCRATCH_BPM_RANGE.max)) return null;
  const weight = genreMoveWeight(ctx.genre);
  const intensity = modeIntensity(ctx.mode) * weight;
  if (weight < 1 || modeIntensity(ctx.mode) < 0.6) return null; // hip-hop, rap and electronic, in an occasion that leans in
  if (!gapElapsed(ctx.lastMoveAtSec, now, barsToSec(scratchGapBars(ctx.frequency, ctx.genre), bpm))) return null;
  const energy = energyAt(analysis, now, durationSec);
  if (energy == null || energy < SCRATCH_MIN_ENERGY) return null;
  const start = nextBoundary(analysis, now, "phrase");
  if (start == null || start - now > barsToSec(2, bpm)) return null; // the phrase must be about to begin
  const note = scratchNoteFor(intensity);
  const sample = SCRATCH_SAMPLES[0];
  return {
    startSec: start,
    note,
    source: pickScratchSource(ctx.stems),
    sample,
    hits: scratchPattern({ startSec: start, bpm, note, sample, songKey: analysis.key }),
    volume: Math.min(1, Math.max(0, ctx.volume)),
    reason: `energy ${energy.toFixed(2)}, ${Math.round(bpm)} BPM, ${note} scratch at the phrase in ${barsUntil(start, now, bpm)} bars`,
  };
}

// ---- As a transition bridge ---------------------------------------------------------------------------------------------------------

/** A tempo gap wider than this (after the octave fold) is a hard match. */
export const HARD_BPM_GAP = 12;
/** A pitch shift of more than this many semitones is a hard match. */
export const HARD_PITCH_SHIFT = 4;

export interface BridgeDecision {
  use: boolean;
  /** Why (or why not), for the transition readout. */
  reason: string;
}

/** Whether a pair is a hard match that a scratch should bridge instead of a long morph: a large tempo gap, a key clash, or a pitch shift above four semitones. */
export function shouldScratchBridge(report: Pick<SyncReport, "bpmDelta" | "tempoConfident" | "keyCompatibility" | "keyConfident" | "morphPitchShiftSemitones" | "suggestedPitchShiftSemitones">): BridgeDecision {
  if (report.tempoConfident && report.bpmDelta > HARD_BPM_GAP) return { use: true, reason: `tempo gap of ${Math.round(report.bpmDelta)} BPM` };
  if (report.keyConfident && report.keyCompatibility === "clash") return { use: true, reason: "the keys clash" };
  const shift = Math.max(Math.abs(report.morphPitchShiftSemitones), Math.abs(report.suggestedPitchShiftSemitones));
  if (report.keyConfident && shift > HARD_PITCH_SHIFT) return { use: true, reason: `a pitch shift of ${shift} semitones` };
  return { use: false, reason: "the pair mixes cleanly" };
}

/**
 * The scratch that bridges two songs: a pattern on the outgoing song's grid starting at its next bar line, in the outgoing song's key (so it sits
 * in what is playing), one bar long. Null when the outgoing song has no usable grid.
 */
export function planScratchBridge(args: { outgoing: TrackAnalysis; currentTimeSec: number; mode?: DjSetMode | null; volume: number; stems?: ScratchContext["stems"]; reason: string }): ScratchMove | null {
  const { outgoing, currentTimeSec: now } = args;
  const start = nextBoundary(outgoing, now, "bar");
  if (start == null) return null;
  const note = scratchNoteFor(modeIntensity(args.mode));
  const sample = SCRATCH_SAMPLES[0];
  return {
    startSec: start,
    note,
    source: pickScratchSource(args.stems),
    sample,
    hits: scratchPattern({ startSec: start, bpm: outgoing.bpm, note, sample, songKey: outgoing.key }),
    volume: Math.min(1, Math.max(0, args.volume)),
    reason: `scratch bridge (${args.reason})`,
  };
}
