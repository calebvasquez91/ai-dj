/**
 * The sync engine's analysis half: for a pair of tracks (the one playing and the one coming), a SyncReport — what
 * has to happen to the incoming track for the two to mix cleanly (tempo strategy, key shift), where to leave and
 * enter, the energy arc and how the stems would hand over. Pure; the audio itself is still DualDeckStage's.
 *
 * The report must never claim more than the player does: the tempo numbers are the ones the mix engine itself uses
 * (octave-folded, bestTempoRatio), the window and mix-out point are the engine's own, and a key shift is only ever a
 * SUGGESTION until DualDeckStage can pitch-shift (PITCH_SHIFT_APPLIED).
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
  MAX_ACTIVE_PLAY_SEC,
  MIN_TEMPO_CONFIDENCE_FOR_TRUST,
  TEMPO_SYNC_MAX_DELTA,
  bestTempoRatio,
  camelotCompatibility,
  snapToBeatGrid,
  type TransitionPlan,
} from "@/lib/mix-engine";
import { energyProfileFromPeaks } from "@/lib/energyProfile";
import { snapToDownbeatOrPhrase } from "@/lib/phrase-align";
import { formatTime } from "@/lib/format";
import { TRANSITION_FX_ENABLED } from "@/lib/transitionFx";

// Song Sync Mode's one switch for everything that isn't the two songs (see lib/transitionFx.ts for what it silences).
// Defined in a leaf module so the mix engine can read it too; this is where the rest of the app imports it from.
export { TRANSITION_FX_ENABLED };

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

export type BpmStrategy = "exact" | "stretch" | "halftime" | "doubletime" | "freeform";

/** Up to this many BPM apart (after folding to the nearest octave) the two share a grid and need no real stretch. */
export const EXACT_MAX_BPM_DELTA = 2;

export interface BpmPlan {
  trackA_bpm: number;
  trackB_bpm: number;
  /** B's tempo after folding to the octave nearest A's (what the engine actually matches against); equals trackB_bpm when no fold. */
  trackB_bpmMatched: number;
  /** BPM apart after the octave fold. */
  bpmDelta: number;
  /** B / A, before folding. */
  bpmRatio: number;
  bpmStrategy: BpmStrategy;
  /** Playback rate of track B at the start of the mix (1 = untouched): the engine's bestTempoRatio when it syncs tempo. */
  stretchAmount: number;
  /** False when either tempo reading is the neutral fallback or too uncertain to act on. */
  tempoConfident: boolean;
}

/**
 * Tempo strategy for A -> B, mirroring the mix engine: B's tempo is folded to the octave nearest A's (a track read at
 * half or double its real tempo still matches), and the pair is syncable within the engine's TEMPO_SYNC_MAX_DELTA
 * (8%). Beyond that the engine leaves B at its own tempo: "freeform".
 */
export function planBpm(a: Pick<TrackAnalysis, "bpm" | "bpmConfidence">, b: Pick<TrackAnalysis, "bpm" | "bpmConfidence">): BpmPlan {
  const base = {
    trackA_bpm: a.bpm,
    trackB_bpm: b.bpm,
    bpmRatio: a.bpm > 0 ? b.bpm / a.bpm : 1,
  };
  const tempoConfident =
    a.bpm > 0 &&
    b.bpm > 0 &&
    a.bpmConfidence >= MIN_TEMPO_CONFIDENCE_FOR_TRUST &&
    b.bpmConfidence >= MIN_TEMPO_CONFIDENCE_FOR_TRUST;
  if (!tempoConfident) {
    // Never stretch toward a tempo that is really the 120 BPM fallback.
    return {
      ...base,
      trackB_bpmMatched: b.bpm,
      bpmDelta: Math.abs(a.bpm - b.bpm),
      bpmStrategy: "freeform",
      stretchAmount: 1,
      tempoConfident,
    };
  }

  const ratio = bestTempoRatio(a.bpm, b.bpm); // a / (b folded)
  const matchedB = a.bpm / ratio;
  const bpmDelta = Math.abs(a.bpm - matchedB);
  const folded = { ...base, trackB_bpmMatched: matchedB, bpmDelta, tempoConfident };
  if (Math.abs(ratio - 1) > TEMPO_SYNC_MAX_DELTA) return { ...folded, bpmStrategy: "freeform", stretchAmount: 1 };

  const fold = matchedB / b.bpm; // 0.5: B is double A's tempo, 2: B is half of it
  let bpmStrategy: BpmStrategy;
  if (Math.abs(fold - 0.5) < 1e-6) bpmStrategy = "halftime";
  else if (Math.abs(fold - 2) < 1e-6) bpmStrategy = "doubletime";
  else bpmStrategy = bpmDelta <= EXACT_MAX_BPM_DELTA ? "exact" : "stretch";
  return { ...folded, bpmStrategy, stretchAmount: ratio };
}

// ---------------------------------------------------------------------------
// Key
// ---------------------------------------------------------------------------

export type KeyCompatibility = "perfect" | "compatible" | "tension" | "clash" | "unknown";

/** Largest pitch shift the engine will recommend: past a few semitones the stretch/shift artifacts outweigh the key gain. */
export const MAX_PITCH_SHIFT_SEMITONES = 3;

/**
 * Whether playback actually pitch-shifts the incoming track. It does not yet (DualDeckStage only changes playback
 * rate), so a "shift" in the report is advice, and every place that words it must say so.
 */
export const PITCH_SHIFT_APPLIED = false;

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
  /** Semitones that WOULD bring B's key onto or next to A's; 0 when already compatible, unknown, or no shift within the limit helps. Advice only: see PITCH_SHIFT_APPLIED. */
  suggestedPitchShiftSemitones: number;
  /** Per-stem shift for the planned stem swap (drums never, bass half, melody and vocals fully). Not applied yet either. */
  stemPitchShifts: { drums: number; bass: number; melody: number; vocals: number };
  /** Semitones to bend track A by so its key lands exactly on B's (shortest way round the wheel, -6..+6); 0 when the keys already agree, are compatible, or are unknown. This is what Song Sync Mode's morph applies to A. */
  morphPitchShiftSemitones: number;
  keyConfident: boolean;
}

/** Shortest signed shift (-6..+6) that moves A's Camelot number onto B's: each semitone moves a key 7 numbers round the wheel, and 7 is its own inverse mod 12. */
export function semitonesToMatchCamelotNumber(aNumber: number, bNumber: number): number {
  const s = ((((bNumber - aNumber) * 7) % 12) + 12) % 12;
  return s > 6 ? s - 12 : s;
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
      suggestedPitchShiftSemitones: 0,
      stemPitchShifts: shifts(0),
      morphPitchShiftSemitones: 0,
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

  let suggestedPitchShiftSemitones = 0;
  if (keyCompatibility === "tension" || keyCompatibility === "clash") {
    for (let magnitude = 1; magnitude <= MAX_PITCH_SHIFT_SEMITONES; magnitude++) {
      const hit = [magnitude, -magnitude].find((s) => {
        const shifted = shiftCamelot(b.camelotKey as string, s);
        return shifted != null && camelotCompatibility(a.camelotKey, shifted) >= 1;
      });
      if (hit != null) {
        suggestedPitchShiftSemitones = hit;
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
    suggestedPitchShiftSemitones,
    stemPitchShifts: shifts(suggestedPitchShiftSemitones),
    // Only a pair that isn't already harmonically compatible is worth bending: shifting a fifth to land "exactly" on
    // a neighbouring key that already mixes cleanly would cost more in artifacts than it gains.
    morphPitchShiftSemitones:
      keyCompatibility === "tension" || keyCompatibility === "clash"
        ? semitonesToMatchCamelotNumber(pa.number, pb.number)
        : 0,
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
  /** The latest point the DJ leaves track A by, ms into A: the end minus the window, but never past the engine's active-play cap. Opportunistic triggers (a breakdown or drop opening after 90 s, a voice cut-off, a mashup) can fire earlier. */
  mixOutMs: number;
  /** How mixOutMs sits against A's grid: on a bar line (trustworthy song map), on a beat, or between beats. The engine doesn't snap its trigger, so this describes, it doesn't promise. */
  mixOutAlignment: "downbeat" | "beat" | "off-grid";
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
  plan?: Pick<TransitionPlan, "windowSec" | "windowBeats" | "incomingEntryOffsetSec" | "transitionId" | "tempoRatioStart"> | null;
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

/** How close the mix-out must be to a bar line / beat to be described as being on it. */
const ALIGN_TOLERANCE_SEC = 0.1;

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

  // The engine's own numbers where it has made a plan: its entry point and window. DualDeckStage clamps the window
  // to half the outgoing track and to what is left of the incoming one, repeated here so the times agree.
  const durationA = current.track.durationSec;
  const mixInSec = plan?.incomingEntryOffsetSec ?? next.analysis.energyOnsetSec;
  const plannedWindowSec = plan?.windowSec ?? defaultWindowSec(current.analysis.bpm);
  const windowSec = Math.min(plannedWindowSec, durationA / 2, Math.max(1, next.track.durationSec - mixInSec));
  const bpmForBeats = current.analysis.bpm > 0 ? current.analysis.bpm : 120;
  const windowBeats = plan?.windowBeats && plan.windowBeats > 0 ? plan.windowBeats : (windowSec * bpmForBeats) / 60;

  // A plan that ramps tempo through a wide gap (a Tempo Ramp transition) is the engine's decision, so it wins over
  // the plain sync rule.
  let { bpmStrategy, stretchAmount } = bpm;
  if (plan?.tempoRatioStart != null && bpm.tempoConfident) {
    stretchAmount = plan.tempoRatioStart;
    if (bpmStrategy === "freeform" && stretchAmount !== 1) bpmStrategy = "stretch";
  }

  // Mix-out: the latest the engine starts leaving the track (the end minus the window, or a requested point), and
  // never later than its active-play cap (DualDeckStage's pastActiveCap: MAX_ACTIVE_PLAY_SEC minus the window), never
  // before where the track is now. It is not snapped to the grid; the alignment is only reported.
  const latestExit = Math.min(mixOutSec ?? Math.max(0, durationA - windowSec), Math.max(0, MAX_ACTIVE_PLAY_SEC - windowSec));
  const wanted = Math.max(currentElapsedSec ?? 0, latestExit);
  const mixOutSecFinal = Math.min(wanted, Math.max(0, durationA));
  const barLine = snapToDownbeatOrPhrase(current.analysis.songMap, mixOutSecFinal, { preferPhrase: false });
  const beatGrid = snapToBeatGrid(
    mixOutSecFinal,
    current.analysis.beatGridOffsetSec,
    current.analysis.bpm > 0 ? current.analysis.bpm : 0
  );
  const mixOutAlignment: SyncReport["mixOutAlignment"] =
    barLine != null && Math.abs(barLine - mixOutSecFinal) <= ALIGN_TOLERANCE_SEC
      ? "downbeat"
      : Math.abs(beatGrid - mixOutSecFinal) <= ALIGN_TOLERANCE_SEC
        ? "beat"
        : "off-grid";

  const outEnergy = energyAt(current.analysis, mixOutSecFinal, durationA);
  const inEnergy = energyAt(next.analysis, mixInSec, next.track.durationSec);

  return {
    ...bpm,
    ...key,
    bpmStrategy,
    stretchAmount,
    mixOutMs: Math.round(mixOutSecFinal * 1000),
    mixOutAlignment,
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
  const stretch = `stretch ${signed((r.stretchAmount - 1) * 100, 1)}%`;
  const hasStretch = Math.abs(r.stretchAmount - 1) >= 0.0005;
  switch (r.bpmStrategy) {
    case "exact":
      return r.bpmDelta < 0.1 ? "BPM matched" : `BPM within ${r.bpmDelta.toFixed(1)}`;
    case "stretch":
      return `BPM ${stretch}`;
    case "halftime":
      return hasStretch ? `half-time, ${stretch}` : "half-time";
    case "doubletime":
      return hasStretch ? `double-time, ${stretch}` : "double-time";
    case "freeform":
      return "BPM gap, no tempo match";
  }
}

/** The report's key wording for the DJ board. A suggested shift is described as advice, never as something done. */
export function describeKey(r: Pick<SyncReport, "keyCompatibility" | "suggestedPitchShiftSemitones">): string {
  if (r.keyCompatibility === "unknown") return "key unknown";
  const base =
    r.keyCompatibility === "perfect"
      ? "same key"
      : r.keyCompatibility === "compatible"
        ? "keys compatible"
        : r.keyCompatibility === "tension"
          ? "keys in tension"
          : "keys clash";
  const shift = r.suggestedPitchShiftSemitones;
  if (shift === 0) return base;
  const n = Math.abs(shift);
  const words = `${signed(shift, 0)} semitone${n === 1 ? "" : "s"}`;
  return PITCH_SHIFT_APPLIED ? `${base}, shifted ${words}` : `${base} (a ${words} shift would help; not applied)`;
}

/** "Next: Title - BPM stretch +3.2% - keys clash (a -2 semitones shift would help; not applied) - Mix out by 2:22 on beat" */
export function describeSyncReport(report: SyncReport, nextTitle: string): string {
  const align = report.mixOutAlignment === "off-grid" ? "" : ` on ${report.mixOutAlignment}`;
  const mixOut = `Mix out by ${formatTime(report.mixOutMs / 1000)}${align}`;
  return `Next: ${nextTitle} — ${describeBpm(report)} — ${describeKey(report)} — ${mixOut}`;
}

/** Compact per-candidate view of how a track would sync after the playing one — what the AI next-pick is given. */
export interface CandidateSyncSummary {
  bpmStrategy: BpmStrategy;
  bpmDelta: number | null;
  /** Percent change applied to the candidate's speed (+3.2 = plays 3.2% faster); 0 when none. */
  stretchPercent: number;
  keyCompatibility: KeyCompatibility;
  /** What would fix the key clash: NOT something the player does (see PITCH_SHIFT_APPLIED). */
  suggestedPitchShiftSemitones: number;
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
    suggestedPitchShiftSemitones: key.suggestedPitchShiftSemitones,
  };
}
