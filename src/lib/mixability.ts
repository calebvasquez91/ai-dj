/**
 * The Audio Engineer's side of a genre-aware transition: a MixabilityReport for a pair of songs (what the analysis knows about how mixable they
 * are at the two mix points), and the vetoes the Engineer raises against plans it knows will sound bad. The DJ (lib/transitionChoice.ts) picks among
 * the plans that are not vetoed. Pure: it reads analysis the app already has and never touches the sync engine.
 *
 * Facts the app cannot know yet (vocal density, instrumentalness) are null, and a null never vetoes anything: the Engineer only blocks what it can see.
 */
import type { TrackAnalysis } from "@/lib/audio-analysis-core";
import { MIN_KEY_CONFIDENCE_FOR_SCORING } from "@/lib/mix-engine";
import type { RankedPlan } from "@/lib/transitionPlanner";
import type { TransitionStyle } from "@/lib/genreTransitions";

/** Below this beat (tempo) confidence a beat-synced blend would be built on a guess. */
export const BEAT_CONFIDENCE_MIN = 0.5;
/** Below this tempo stability (how evenly spaced the tracked beats are) a grid cannot be trusted across a long blend. */
export const TEMPO_STABILITY_MIN = 0.3;
/**
 * Below this key confidence a blend that depends on the keys agreeing is a gamble. It is the app's own line for trusting a key reading (the sync engine and
 * the transition scoring use it), not a stricter one: most real songs read a key confidence under 0.3, so a stricter line vetoed nearly every blend (found
 * by a dry run on the real library).
 */
export const KEY_CONFIDENCE_MIN = MIN_KEY_CONFIDENCE_FOR_SCORING;
/** At or above this vocal density (0-1, share of the window with a lead vocal) an end is "heavy vocals". */
export const HEAVY_VOCAL_DENSITY = 0.6;

/** Styles that run the two songs together on a shared grid. */
const BEAT_SYNCED: ReadonlySet<TransitionStyle> = new Set<TransitionStyle>(["long-blend", "medium-blend", "short-blend", "bass-swap", "filter-sweep"]);
/** Styles whose sound depends on the two keys agreeing while they overlap. */
const KEY_DEPENDENT: ReadonlySet<TransitionStyle> = new Set<TransitionStyle>(["long-blend", "medium-blend", "vocal-swap"]);

export interface MixabilityReport {
  beatConfidenceA: number;
  beatConfidenceB: number;
  tempoStabilityA: number;
  tempoStabilityB: number;
  keyConfidenceA: number;
  keyConfidenceB: number;
  /** 0-1 share of the window with a lead vocal; null when unknown (no vocal activity timeline yet). */
  vocalDensityAtMixOut: number | null;
  vocalDensityAtMixIn: number | null;
  /** 0-1; null when the waveform is missing. */
  energyAtMixOut: number | null;
  energyAtMixIn: number | null;
  /** 0-1 how instrumental the song is; null when unknown. */
  instrumentalnessA: number | null;
  instrumentalnessB: number | null;
  /** 0-1 overall: how easily this pair mixes. */
  mixability: number;
  /** Plain-words limits the Engineer found, for the readout. */
  constraints: string[];
}

export interface MixabilityInput {
  a: TrackAnalysis;
  b: TrackAnalysis;
  durationA: number;
  durationB: number;
  /** Where the outgoing song is left, and where the incoming one is entered, in seconds. */
  mixOutSec: number;
  mixInSec: number;
  vocalDensityAtMixOut?: number | null;
  vocalDensityAtMixIn?: number | null;
  instrumentalnessA?: number | null;
  instrumentalnessB?: number | null;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** The waveform level around a point in a song (mean of the peaks within a few seconds), 0-1; null without a waveform. */
export function energyAround(analysis: Pick<TrackAnalysis, "waveformPeaks">, durationSec: number, atSec: number, spanSec = 4): number | null {
  const peaks = analysis.waveformPeaks;
  if (!peaks || peaks.length === 0 || !(durationSec > 0)) return null;
  const per = durationSec / peaks.length;
  const from = Math.max(0, Math.floor((atSec - spanSec / 2) / per));
  const to = Math.min(peaks.length - 1, Math.max(from, Math.ceil((atSec + spanSec / 2) / per)));
  let sum = 0;
  for (let i = from; i <= to; i++) sum += peaks[i];
  return clamp01(sum / (to - from + 1));
}

const stabilityOf = (a: TrackAnalysis): number => a.songMap?.tempoConfidence ?? a.bpmConfidence;

export function buildMixabilityReport(input: MixabilityInput): MixabilityReport {
  const { a, b } = input;
  const base = {
    beatConfidenceA: a.bpmConfidence,
    beatConfidenceB: b.bpmConfidence,
    tempoStabilityA: stabilityOf(a),
    tempoStabilityB: stabilityOf(b),
    keyConfidenceA: a.keyConfidence,
    keyConfidenceB: b.keyConfidence,
    vocalDensityAtMixOut: input.vocalDensityAtMixOut ?? null,
    vocalDensityAtMixIn: input.vocalDensityAtMixIn ?? null,
    energyAtMixOut: energyAround(a, input.durationA, input.mixOutSec),
    energyAtMixIn: energyAround(b, input.durationB, input.mixInSec),
    instrumentalnessA: input.instrumentalnessA ?? null,
    instrumentalnessB: input.instrumentalnessB ?? null,
  };
  const constraints: string[] = [];
  if (Math.min(base.beatConfidenceA, base.beatConfidenceB) < BEAT_CONFIDENCE_MIN) constraints.push("the tempo is not certain");
  if (Math.min(base.tempoStabilityA, base.tempoStabilityB) < TEMPO_STABILITY_MIN) constraints.push("the beat is not steady");
  if (Math.min(base.keyConfidenceA, base.keyConfidenceB) < KEY_CONFIDENCE_MIN) constraints.push("the key is not certain");
  if (heavyVocalsBothEnds(base)) constraints.push("both ends have heavy vocals");
  const confidence = (Math.min(base.beatConfidenceA, base.beatConfidenceB) + Math.min(base.tempoStabilityA, base.tempoStabilityB) + Math.min(base.keyConfidenceA, base.keyConfidenceB)) / 3;
  const mixability = clamp01(confidence - (heavyVocalsBothEnds(base) ? 0.2 : 0));
  return { ...base, mixability, constraints };
}

function heavyVocalsBothEnds(r: Pick<MixabilityReport, "vocalDensityAtMixOut" | "vocalDensityAtMixIn">): boolean {
  return r.vocalDensityAtMixOut != null && r.vocalDensityAtMixIn != null && r.vocalDensityAtMixOut >= HEAVY_VOCAL_DENSITY && r.vocalDensityAtMixIn >= HEAVY_VOCAL_DENSITY;
}

// ---- The vetoes -----------------------------------------------------------------------------------------------------------------------

export interface Veto {
  /** The style it blocks. */
  style: TransitionStyle;
  reason: string;
}

/** Every style the Engineer blocks for this pair, with why. */
export function engineerVetoes(report: MixabilityReport): Map<TransitionStyle, string> {
  const out = new Map<TransitionStyle, string>();
  const beatBad = Math.min(report.beatConfidenceA, report.beatConfidenceB) < BEAT_CONFIDENCE_MIN;
  const unsteady = Math.min(report.tempoStabilityA, report.tempoStabilityB) < TEMPO_STABILITY_MIN;
  if (beatBad || unsteady) {
    const why = beatBad ? "beat confidence is below 0.5" : "the tempo is not stable";
    for (const s of BEAT_SYNCED) out.set(s, why);
  }
  if (heavyVocalsBothEnds(report)) out.set("long-blend", "both ends have heavy vocals");
  if (Math.min(report.keyConfidenceA, report.keyConfidenceB) < KEY_CONFIDENCE_MIN) for (const s of KEY_DEPENDENT) if (!out.has(s)) out.set(s, "the key is not certain");
  return out;
}

export interface VetoResult<P extends Pick<RankedPlan, "style">> {
  allowed: P[];
  vetoed: { plan: P; reason: string }[];
}

/** Splits ranked plans into the ones the Engineer allows and the ones it vetoes. A fade, cut or echo is never vetoed, so something always remains. */
export function applyVetoes<P extends Pick<RankedPlan, "style">>(plans: readonly P[], report: MixabilityReport): VetoResult<P> {
  const vetoes = engineerVetoes(report);
  const allowed: P[] = [];
  const vetoed: { plan: P; reason: string }[] = [];
  for (const plan of plans) {
    const reason = vetoes.get(plan.style);
    if (reason) vetoed.push({ plan, reason });
    else allowed.push(plan);
  }
  return { allowed, vetoed };
}
