/**
 * The sync engine's analysis half: for a pair of tracks (the one playing and the one coming), a SyncReport — what
 * has to happen to the incoming track for the two to mix cleanly (tempo strategy, key shift), where to leave and
 * enter, the energy arc and how the stems would hand over. Pure; the audio itself is still DualDeckStage's.
 *
 * It sits between the audio engineer's measurements (TrackAnalysis, song map, energy profile) and the DJ (the mix
 * engine's planTransition and the AI next-pick): the DJ board shows its one-line summary, and the AI is briefed
 * with it. It reuses, rather than replaces, the existing tempo/key rules (bestTempoRatio's octave handling,
 * camelotCompatibility), so the report agrees with what the mix engine will actually do.
 *
 * Key compatibility uses the Camelot wheel, not raw semitone intervals: relative major/minor (3 semitones apart in
 * root) is the MOST compatible pair there, and pitch-shifting moves a key along the wheel by 7 numbers per semitone.
 */
import type { TrackAnalysis } from "@/lib/audio-analysis";
import type { Track } from "@/types/music";
import {
  MIN_KEY_CONFIDENCE_FOR_SCORING,
  MIN_TEMPO_CONFIDENCE_FOR_TRUST,
  camelotCompatibility,
  snapToBeatGrid,
  type TransitionPlan,
} from "@/lib/mix-engine";
import { energyProfileFromPeaks } from "@/lib/energyProfile";
import { snapToDownbeatOrPhrase } from "@/lib/phrase-align";
import { formatTime } from "@/lib/format";

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

export type BpmStrategy = "exact" | "stretch" | "halftime" | "doubletime" | "freeform";

/** Up to this many BPM apart the two share a grid with no stretch. */
export const EXACT_MAX_BPM_DELTA = 2;
/** Up to this many BPM apart the incoming track is time-stretched to the outgoing tempo. */
export const STRETCH_MAX_BPM_DELTA = 8;
/** How close to exactly double/half a tempo counts as a half/double-time fit. */
export const HALF_DOUBLE_TOLERANCE = 0.03;
/** The long, FX-masked crossfade used when the tempos can't be reconciled. */
export const FREEFORM_CROSSFADE_MS = 24_000;

export interface BpmPlan {
  trackA_bpm: number;
  trackB_bpm: number;
  bpmDelta: number;
  /** B / A. */
  bpmRatio: number;
  bpmStrategy: BpmStrategy;
  /** Playback-rate multiplier for track B (1 = untouched). */
  stretchAmount: number;
  /** False when either tempo reading is the neutral fallback or too uncertain to act on. */
  tempoConfident: boolean;
}

export function planBpm(a: Pick<TrackAnalysis, "bpm" | "bpmConfidence">, b: Pick<TrackAnalysis, "bpm" | "bpmConfidence">): BpmPlan {
  const base = {
    trackA_bpm: a.bpm,
    trackB_bpm: b.bpm,
    bpmDelta: Math.abs(a.bpm - b.bpm),
    bpmRatio: a.bpm > 0 ? b.bpm / a.bpm : 1,
  };
  const tempoConfident =
    a.bpm > 0 &&
    b.bpm > 0 &&
    a.bpmConfidence >= MIN_TEMPO_CONFIDENCE_FOR_TRUST &&
    b.bpmConfidence >= MIN_TEMPO_CONFIDENCE_FOR_TRUST;
  // Never stretch toward a tempo that is really the 120 BPM fallback.
  if (!tempoConfident) return { ...base, bpmStrategy: "freeform", stretchAmount: 1, tempoConfident };

  const toA = a.bpm / b.bpm;
  if (base.bpmDelta <= EXACT_MAX_BPM_DELTA) return { ...base, bpmStrategy: "exact", stretchAmount: 1, tempoConfident };
  if (Math.abs(b.bpm / (a.bpm * 2) - 1) <= HALF_DOUBLE_TOLERANCE) {
    return { ...base, bpmStrategy: "halftime", stretchAmount: toA, tempoConfident };
  }
  if (Math.abs(b.bpm / (a.bpm / 2) - 1) <= HALF_DOUBLE_TOLERANCE) {
    return { ...base, bpmStrategy: "doubletime", stretchAmount: toA, tempoConfident };
  }
  // The spec's 8–15 BPM band has no rule of its own; stretching that far is where time-stretch artifacts become
  // audible, so it is treated as freeform (long fade) rather than stretched.
  if (base.bpmDelta <= STRETCH_MAX_BPM_DELTA) return { ...base, bpmStrategy: "stretch", stretchAmount: toA, tempoConfident };
  return { ...base, bpmStrategy: "freeform", stretchAmount: 1, tempoConfident };
}

// ---------------------------------------------------------------------------
// Key
// ---------------------------------------------------------------------------

export type KeyCompatibility = "perfect" | "compatible" | "tension" | "clash" | "unknown";

/** Largest pitch shift the engine will recommend: past a few semitones the stretch/shift artifacts outweigh the key gain. */
export const MAX_PITCH_SHIFT_SEMITONES = 3;

interface Camelot {
  number: number;
  letter: "A" | "B";
}

function parseCamelot(code: string | null): Camelot | null {
  const m = code?.match(/^(\d{1,2})([AB])$/);
  if (!m) return null;
  const number = parseInt(m[1], 10);
  return number >= 1 && number <= 12 ? { number, letter: m[2] as "A" | "B" } : null;
}

/** The Camelot code a key lands on when pitch-shifted by `semitones` (7 wheel numbers per semitone, same mode). */
export function shiftCamelot(code: string, semitones: number): string | null {
  const c = parseCamelot(code);
  if (!c) return null;
  const number = ((((c.number - 1 + 7 * semitones) % 12) + 12) % 12) + 1;
  return `${number}${c.letter}`;
}

/** Pitch class (0 = C) of the key's tonic. 8B = C major, 8A = A minor. */
function tonicPitchClass(c: Camelot): number {
  const major = (((c.number - 8) * 7) % 12 + 12) % 12;
  return c.letter === "B" ? major : (major + 9) % 12;
}

function wheelDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
}

export interface KeyPlan {
  trackA_key: string;
  trackB_key: string;
  /** Signed semitones from B's tonic to A's, folded to -6..+5 (informational). 0 when a key is unknown. */
  semitoneDelta: number;
  keyCompatibility: KeyCompatibility;
  /** Semitones to shift B so its key sits on or next to A's; 0 when already compatible, unknown, or no shift within the limit helps. */
  pitchShiftSemitones: number;
  /** Per-stem shift: drums never, bass half (warmth), melody and vocals fully. */
  stemPitchShifts: { drums: number; bass: number; melody: number; vocals: number };
  keyConfident: boolean;
}

export function planKey(
  a: Pick<TrackAnalysis, "camelotKey" | "key" | "keyConfidence">,
  b: Pick<TrackAnalysis, "camelotKey" | "key" | "keyConfidence">
): KeyPlan {
  const pa = parseCamelot(a.camelotKey);
  const pb = parseCamelot(b.camelotKey);
  const keyConfident =
    pa != null &&
    pb != null &&
    a.keyConfidence >= MIN_KEY_CONFIDENCE_FOR_SCORING &&
    b.keyConfidence >= MIN_KEY_CONFIDENCE_FOR_SCORING;
  const label = (analysis: Pick<TrackAnalysis, "camelotKey" | "key">) => analysis.key ?? analysis.camelotKey ?? "unknown";
  const shifts = (s: number) => ({ drums: 0, bass: s * 0.5, melody: s, vocals: s });

  if (!keyConfident || !pa || !pb || !a.camelotKey || !b.camelotKey) {
    return {
      trackA_key: label(a),
      trackB_key: label(b),
      semitoneDelta: 0,
      keyCompatibility: "unknown",
      pitchShiftSemitones: 0,
      stemPitchShifts: shifts(0),
      keyConfident: false,
    };
  }

  const score = camelotCompatibility(a.camelotKey, b.camelotKey);
  let keyCompatibility: KeyCompatibility;
  if (score >= 2) keyCompatibility = "perfect";
  else if (score === 1) keyCompatibility = "compatible";
  else {
    // not directly compatible: the "diagonal" neighbour or a whole step round the wheel is a tension mix, the rest clash
    const sameLetter = pa.letter === pb.letter;
    const d = wheelDistance(pa.number, pb.number);
    keyCompatibility = (!sameLetter && d === 1) || (sameLetter && d === 2) ? "tension" : "clash";
  }

  let pitchShiftSemitones = 0;
  if (keyCompatibility === "tension" || keyCompatibility === "clash") {
    for (let magnitude = 1; magnitude <= MAX_PITCH_SHIFT_SEMITONES; magnitude++) {
      const hit = [magnitude, -magnitude].find((s) => {
        const shifted = shiftCamelot(b.camelotKey as string, s);
        return shifted != null && camelotCompatibility(a.camelotKey, shifted) >= 1;
      });
      if (hit != null) {
        pitchShiftSemitones = hit;
        break;
      }
    }
  }

  let semitoneDelta = (((tonicPitchClass(pa) - tonicPitchClass(pb)) % 12) + 12) % 12;
  if (semitoneDelta > 5) semitoneDelta -= 12;
  return {
    trackA_key: label(a),
    trackB_key: label(b),
    semitoneDelta,
    keyCompatibility,
    pitchShiftSemitones,
    stemPitchShifts: shifts(pitchShiftSemitones),
    keyConfident: true,
  };
}

// ---------------------------------------------------------------------------
// Energy
// ---------------------------------------------------------------------------

export type EnergyStrategy = "build" | "sustain" | "release" | "contrast";

/** Energy change (0-1 scale) below which the mix just holds the level. */
const ENERGY_HOLD_DELTA = 0.15;
/** Energy change at or above which it is a deliberate contrast, not a build or release. */
const ENERGY_CONTRAST_DELTA = 0.5;

function energyAt(analysis: TrackAnalysis, atSec: number, durationSec: number): number | null {
  if (!(durationSec > 0)) return null;
  const profile = energyProfileFromPeaks(analysis.waveformPeaks);
  if (profile.length === 0) return null;
  const index = Math.min(profile.length - 1, Math.max(0, Math.floor((atSec / durationSec) * profile.length)));
  return profile[index];
}

export function energyStrategyFor(outEnergy: number | null, inEnergy: number | null): EnergyStrategy {
  if (outEnergy == null || inEnergy == null) return "sustain";
  const delta = inEnergy - outEnergy;
  if (Math.abs(delta) >= ENERGY_CONTRAST_DELTA) return "contrast";
  if (delta >= ENERGY_HOLD_DELTA) return "build";
  if (delta <= -ENERGY_HOLD_DELTA) return "release";
  return "sustain";
}

// ---------------------------------------------------------------------------
// Stems
// ---------------------------------------------------------------------------

export type StemName = "drums" | "bass" | "melody" | "vocals";
/** The hand-over order: the beat transfers first, the voice last. */
export const STEM_SWAP_ORDER: readonly StemName[] = ["drums", "bass", "melody", "vocals"];

/**
 * When each stem swaps, in ms from the crossfade start: one per bar from bar 2 on a long mix (20+ beats), every two
 * beats on a short one. Never later than the last beat of the window.
 */
export function stemSwapTimings(bpm: number, windowBeats: number): number[] {
  const beatMs = 60_000 / (bpm > 0 ? bpm : 120);
  const stepBeats = windowBeats >= 20 ? 4 : 2;
  const lastMs = Math.max(0, (windowBeats - 1) * beatMs);
  return STEM_SWAP_ORDER.map((_, i) => Math.min(Math.round((i + 1) * stepBeats * beatMs), Math.round(lastMs)));
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface SyncReport extends BpmPlan, KeyPlan {
  // timing
  /** When to start leaving track A, ms into A. */
  mixOutMs: number;
  /** True when mixOutMs is on one of A's bar lines (a trustworthy song map), false when only on its beat grid. */
  mixOutOnDownbeat: boolean;
  /** Where to enter track B, ms into B. */
  mixInMs: number;
  crossfadeDurationMs: number;
  transitionStyle: string;
  // energy
  trackA_energyAtMixOut: number | null;
  trackB_energyAtMixIn: number | null;
  energyStrategy: EnergyStrategy;
  // stems
  stemSwapOrder: StemName[];
  stemSwapTimings: number[];
  /** All four stems of BOTH tracks are separated, so the stem-by-stem hand-over could actually be played. */
  stemSwapAvailable: boolean;
}

export interface SyncInputTrack {
  track: Track;
  analysis: TrackAnalysis;
}

export interface SyncReportInput {
  current: SyncInputTrack;
  next: SyncInputTrack;
  /** The mix engine's plan for this pair, when there is one: supplies the entry point, window and style. */
  plan?: Pick<TransitionPlan, "windowSec" | "windowBeats" | "incomingEntryOffsetSec" | "transitionId"> | null;
  /** Where the outgoing track is now; the mix-out point is never earlier than this. */
  currentElapsedSec?: number | null;
  /** When the DJ means to start leaving the outgoing track, if known (e.g. a voice cut-off); defaults to the natural end. */
  mixOutSec?: number | null;
  incomingStemsReady?: boolean;
  outgoingStemsReady?: boolean;
}

/** Fallback crossfade length when there is no plan: 16 beats at the outgoing tempo, kept within 8–16 s. */
function defaultWindowSec(bpm: number): number {
  const sec = bpm > 0 ? (16 * 60) / bpm : 8;
  return Math.min(16, Math.max(8, sec));
}

export function buildSyncReport({
  current,
  next,
  plan = null,
  currentElapsedSec = null,
  mixOutSec = null,
  incomingStemsReady = false,
  outgoingStemsReady = false,
}: SyncReportInput): SyncReport {
  const bpm = planBpm(current.analysis, next.analysis);
  const key = planKey(current.analysis, next.analysis);

  const windowSec = bpm.bpmStrategy === "freeform" ? FREEFORM_CROSSFADE_MS / 1000 : (plan?.windowSec ?? defaultWindowSec(current.analysis.bpm));
  const bpmForBeats = current.analysis.bpm > 0 ? current.analysis.bpm : 120;
  const windowBeats = plan?.windowBeats && plan.windowBeats > 0 ? plan.windowBeats : (windowSec * bpmForBeats) / 60;

  // Mix-out: the requested point (or the natural end minus the window), never before where the track is now,
  // snapped onto a bar line when the song map can be trusted, otherwise onto the beat grid.
  const durationA = current.track.durationSec;
  const wanted = Math.max(currentElapsedSec ?? 0, mixOutSec ?? Math.max(0, durationA - windowSec));
  const barLine = snapToDownbeatOrPhrase(current.analysis.songMap, wanted, { preferPhrase: false });
  const snapped =
    barLine ?? snapToBeatGrid(wanted, current.analysis.beatGridOffsetSec, current.analysis.bpm > 0 ? current.analysis.bpm : 0);
  const mixOutSecFinal = Math.min(Math.max(snapped, currentElapsedSec ?? 0), Math.max(0, durationA));
  const mixInSec = plan?.incomingEntryOffsetSec ?? next.analysis.energyOnsetSec;

  const outEnergy = energyAt(current.analysis, mixOutSecFinal, durationA);
  const inEnergy = energyAt(next.analysis, mixInSec, next.track.durationSec);

  return {
    ...bpm,
    ...key,
    mixOutMs: Math.round(mixOutSecFinal * 1000),
    mixOutOnDownbeat: barLine != null,
    mixInMs: Math.round(mixInSec * 1000),
    crossfadeDurationMs: Math.round(windowSec * 1000),
    transitionStyle: plan?.transitionId ?? "blend",
    trackA_energyAtMixOut: outEnergy,
    trackB_energyAtMixIn: inEnergy,
    energyStrategy: energyStrategyFor(outEnergy, inEnergy),
    stemSwapOrder: [...STEM_SWAP_ORDER],
    stemSwapTimings: stemSwapTimings(bpmForBeats, windowBeats),
    stemSwapAvailable: incomingStemsReady && outgoingStemsReady,
  };
}

// ---------------------------------------------------------------------------
// Presentation + AI briefing
// ---------------------------------------------------------------------------

function signed(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

/** The report's tempo wording for the DJ board. */
export function describeBpm(r: Pick<SyncReport, "bpmStrategy" | "stretchAmount" | "bpmDelta">): string {
  switch (r.bpmStrategy) {
    case "exact":
      return r.bpmDelta < 0.1 ? "BPM matched" : `BPM within ${r.bpmDelta.toFixed(1)}`;
    case "stretch":
      return `BPM stretch ${signed((r.stretchAmount - 1) * 100, 1)}%`;
    case "halftime":
      return "half-time";
    case "doubletime":
      return "double-time";
    case "freeform":
      return "BPM gap, long fade";
  }
}

/** The report's key wording for the DJ board. */
export function describeKey(r: Pick<SyncReport, "keyCompatibility" | "pitchShiftSemitones">): string {
  if (r.keyCompatibility === "unknown") return "key unknown";
  if (r.pitchShiftSemitones !== 0) {
    const n = Math.abs(r.pitchShiftSemitones);
    return `Key shift ${signed(r.pitchShiftSemitones, 0)} semitone${n === 1 ? "" : "s"}`;
  }
  if (r.keyCompatibility === "perfect") return "same key";
  if (r.keyCompatibility === "compatible") return "keys compatible";
  return r.keyCompatibility === "tension" ? "keys in tension" : "keys clash";
}

/** "Next: Title — BPM stretch +3.2% — Key shift +2 semitones — Mix out at 3:12 on downbeat" */
export function describeSyncReport(report: SyncReport, nextTitle: string): string {
  const mixOut = `Mix out at ${formatTime(report.mixOutMs / 1000)} on ${report.mixOutOnDownbeat ? "downbeat" : "beat"}`;
  return `Next: ${nextTitle} — ${describeBpm(report)} — ${describeKey(report)} — ${mixOut}`;
}

/** Compact per-candidate view of how a track would sync after the playing one — what the AI next-pick is given. */
export interface CandidateSyncSummary {
  bpmStrategy: BpmStrategy;
  bpmDelta: number | null;
  /** Percent change applied to the candidate's speed (+3.2 = plays 3.2% faster); 0 when none. */
  stretchPercent: number;
  keyCompatibility: KeyCompatibility;
  pitchShiftSemitones: number;
}

export function candidateSyncSummary(
  current: Pick<TrackAnalysis, "bpm" | "bpmConfidence" | "camelotKey" | "key" | "keyConfidence">,
  candidate: Pick<TrackAnalysis, "bpm" | "bpmConfidence" | "camelotKey" | "key" | "keyConfidence">
): CandidateSyncSummary {
  const bpm = planBpm(current, candidate);
  const key = planKey(current, candidate);
  return {
    bpmStrategy: bpm.bpmStrategy,
    bpmDelta: bpm.tempoConfident ? Math.round(bpm.bpmDelta * 10) / 10 : null,
    stretchPercent: Math.round((bpm.stretchAmount - 1) * 1000) / 10,
    keyCompatibility: key.keyCompatibility,
    pitchShiftSemitones: key.pitchShiftSemitones,
  };
}
