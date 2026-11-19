// Instrumental bridges (behind INSTRUMENTAL_BRIDGE_ENABLED): when two songs are far apart in key or tempo, or the energy jumps, the first song
// morphs into an instrumental that sits between them, the instrumental plays for four to eight bars fully phase-locked, and then it morphs into
// the second song. The instrumental is either an instrumental track in the library (marked by a tag, by the filename convention "(Instrumental)",
// or by the Audio Engineer's instrumentalness score) or one built from the stems of a song that has them, with the vocal muted. If nothing suitable
// exists the planner says so and the normal transition is used. Pure.
import { eligibleTracks } from "@/lib/curate/eligibility";
import type { TrackAnalysis } from "@/lib/audio-analysis";
import { camelotCompatibility } from "@/lib/mix-engine";
import { bestTempoRatio } from "@/lib/tempoRatio";
import type { Track } from "@/types/music";

/** The bridge plays for this many bars: four, or eight when the gap it crosses is large. */
export const BRIDGE_BARS = { short: 4, long: 8 } as const;
/** A tempo gap (BPM, after the octave fold) beyond this is a gap worth bridging. */
export const BRIDGE_BPM_GAP = 8;
/** An energy jump (0-1) at least this big is worth bridging. */
export const BRIDGE_ENERGY_JUMP = 0.35;
/** The Audio Engineer's instrumentalness score from which a song counts as an instrumental. */
export const INSTRUMENTALNESS_MIN = 0.8;

/** Whether a track is an instrumental: tagged "instrumental" or "karaoke", named "(Instrumental)", or scored as one. */
export function isInstrumentalTrack(track: Pick<Track, "title" | "tags" | "isInstrumental">, instrumentalness?: number | null): boolean {
  if (track.isInstrumental) return true;
  const tags = (track.tags ?? []).map((t) => t.trim().toLowerCase());
  if (tags.includes("instrumental") || tags.includes("karaoke")) return true;
  if (/\binstrumental\b/i.test(track.title)) return true;
  return instrumentalness != null && instrumentalness >= INSTRUMENTALNESS_MIN;
}

export interface BridgeSide {
  track: Track;
  analysis: TrackAnalysis;
  /** 0-1 energy where the transition leaves this song (A) or enters it (B), when known. */
  energy: number | null;
  /** All the stems of this song are ready, so an instrumental can be built from it with the vocal muted. */
  stemsReady: boolean;
}

/** `bpm` folded to the octave (1x, 2x or half) nearest `reference`, so 70 against 140 counts as the same tempo. */
export function foldTempo(reference: number, bpm: number): number {
  return reference / bestTempoRatio(reference, bpm);
}

export type BridgeReason = { kind: "bpm-gap"; bpmDelta: number } | { kind: "key-clash" } | { kind: "energy-jump"; jump: number };

export interface BridgeNeed {
  needed: boolean;
  /** The size of the gap to cross: a large one gets the longer bridge. */
  large: boolean;
  reasons: BridgeReason[];
}

/** Whether a pair needs a bridge: a large key or tempo gap, or a big energy jump. */
export function bridgeNeed(a: BridgeSide, b: BridgeSide): BridgeNeed {
  const reasons: BridgeReason[] = [];
  const bpmA = a.analysis.bpm;
  const bpmB = b.analysis.bpm;
  const confident = !a.analysis.fallback && !b.analysis.fallback && bpmA > 0 && bpmB > 0;
  let large = false;
  if (confident) {
    const delta = Math.abs(bpmA - foldTempo(bpmA, bpmB));
    if (delta > BRIDGE_BPM_GAP) {
      reasons.push({ kind: "bpm-gap", bpmDelta: Math.round(delta) });
      if (delta > BRIDGE_BPM_GAP * 2) large = true;
    }
  }
  if (a.analysis.camelotKey && b.analysis.camelotKey && a.analysis.keyConfidence >= 0.3 && b.analysis.keyConfidence >= 0.3 && camelotCompatibility(a.analysis.camelotKey, b.analysis.camelotKey) === 0) {
    reasons.push({ kind: "key-clash" });
  }
  if (a.energy != null && b.energy != null && Math.abs(a.energy - b.energy) >= BRIDGE_ENERGY_JUMP) {
    const jump = Math.round(Math.abs(a.energy - b.energy) * 100) / 100;
    reasons.push({ kind: "energy-jump", jump });
    if (jump >= BRIDGE_ENERGY_JUMP * 1.5) large = true;
  }
  if (reasons.length >= 2) large = true;
  return { needed: reasons.length > 0, large, reasons };
}

export type InstrumentalSource = { kind: "library"; track: Track; analysis: TrackAnalysis } | { kind: "stems"; of: Track; analysis: TrackAnalysis };

export interface InstrumentalChoice {
  source: InstrumentalSource;
  /** 0-1 how well it sits between the two songs. */
  score: number;
}

/** How well an instrumental with this tempo and key sits between A and B: its tempo between theirs (or close to both), its key compatible with both. */
export function instrumentalFit(a: TrackAnalysis, b: TrackAnalysis, candidate: TrackAnalysis): number {
  if (candidate.fallback || !(candidate.bpm > 0) || !(a.bpm > 0) || !(b.bpm > 0)) return 0;
  const bMatched = foldTempo(a.bpm, b.bpm);
  const lo = Math.min(a.bpm, bMatched);
  const hi = Math.max(a.bpm, bMatched);
  const bpm = foldTempo((lo + hi) / 2, candidate.bpm);
  const slack = Math.max(0, lo - bpm, bpm - hi);
  const tempo = Math.max(0, 1 - slack / (hi * 0.12 + 1));
  const keyA = a.camelotKey && candidate.camelotKey ? camelotCompatibility(a.camelotKey, candidate.camelotKey) : 1;
  const keyB = b.camelotKey && candidate.camelotKey ? camelotCompatibility(b.camelotKey, candidate.camelotKey) : 1;
  const key = (Math.min(keyA, 1) + Math.min(keyB, 1)) / 2;
  return 0.55 * tempo + 0.45 * key;
}

/** Below this score an instrumental does not sit well enough between the two songs. */
export const INSTRUMENTAL_MIN_FIT = 0.6;

/**
 * The best instrumental between A and B: the library's instrumentals first (allowed ones only: Do-Not-Play and Halloween music are out), or, when
 * none fits, one built from the stems of A or B if they have them. Null when nothing suits, and the normal transition is used.
 */
export function chooseInstrumental(args: { a: BridgeSide; b: BridgeSide; library: readonly Track[]; analysisOf: (track: Track) => TrackAnalysis | null; instrumentalnessOf?: (track: Track) => number | null }): InstrumentalChoice | null {
  const { a, b, library } = args;
  const { tracks } = eligibleTracks(library, { explicitPolicy: "any", allowHalloween: false });
  let best: InstrumentalChoice | null = null;
  for (const track of tracks) {
    if (track.id === a.track.id || track.id === b.track.id) continue;
    if (!isInstrumentalTrack(track, args.instrumentalnessOf?.(track))) continue;
    const analysis = args.analysisOf(track);
    if (!analysis || analysis.fallback) continue;
    const score = instrumentalFit(a.analysis, b.analysis, analysis);
    if (score >= INSTRUMENTAL_MIN_FIT && (!best || score > best.score)) best = { source: { kind: "library", track, analysis }, score };
  }
  if (best) return best;
  for (const side of [a, b]) {
    if (!side.stemsReady || side.analysis.fallback) continue;
    const score = instrumentalFit(a.analysis, b.analysis, side.analysis);
    if (score >= INSTRUMENTAL_MIN_FIT && (!best || score > best.score)) best = { source: { kind: "stems", of: side.track, analysis: side.analysis }, score };
  }
  return best;
}

export interface BridgeStep {
  step: "morph-to-instrumental" | "instrumental" | "morph-to-next";
  /** Shown as its own step in the transition readout. */
  label: string;
  /** For the instrumental step: how many bars it plays, phase-locked to the grid. */
  bars?: number;
}

export interface BridgePlan {
  instrumental: InstrumentalChoice;
  holdBars: number;
  steps: BridgeStep[];
  /** One line for the transition readout. */
  readout: string;
  reasons: BridgeReason[];
}

function describeSource(source: InstrumentalSource): string {
  return source.kind === "library" ? `${source.track.artist} - ${source.track.title}` : `${source.of.title} (instrumental, from its stems)`;
}

function describeReason(r: BridgeReason): string {
  return r.kind === "bpm-gap" ? `tempo gap of ${r.bpmDelta} BPM` : r.kind === "key-clash" ? "the keys clash" : `energy jump of ${r.jump}`;
}

/** The bridge between A and B, or null when none is needed or no instrumental suits (the normal transition is used then). */
export function planInstrumentalBridge(args: { a: BridgeSide; b: BridgeSide; library: readonly Track[]; analysisOf: (track: Track) => TrackAnalysis | null; instrumentalnessOf?: (track: Track) => number | null }): BridgePlan | null {
  const need = bridgeNeed(args.a, args.b);
  if (!need.needed) return null;
  const choice = chooseInstrumental(args);
  if (!choice) return null;
  const holdBars = need.large ? BRIDGE_BARS.long : BRIDGE_BARS.short;
  const name = describeSource(choice.source);
  return {
    instrumental: choice,
    holdBars,
    steps: [
      { step: "morph-to-instrumental", label: `${args.a.track.title} morphs into the instrumental` },
      { step: "instrumental", label: `Instrumental: ${name}`, bars: holdBars },
      { step: "morph-to-next", label: `The instrumental morphs into ${args.b.track.title}` },
    ],
    readout: `${args.a.track.title} → instrumental (${name}, ${holdBars} bars) → ${args.b.track.title} · ${need.reasons.map(describeReason).join(", ")}`,
    reasons: need.reasons,
  };
}
