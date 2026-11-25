/**
 * How each top-level genre likes to be mixed: data only (no logic besides a lookup), so tuning a genre is an edit here, never a code change.
 * The planner (lib/transitionPlanner.ts) reads it to choose WHICH transition style and tools to request for a pair; the sync engine, the morph
 * and the crossfade schedule are not touched by it (a beat-synced plan is handed to them as it is today).
 *
 * Keyed by the top-level labels of the one taxonomy (lib/genres.ts). A test checks every taxonomy genre has an entry.
 */

/** How much a genre depends on the beat grid: `required` (a blend that is off the grid sounds wrong), `preferred`, `unreliable` (live or drifting tempo: do not trust a grid), `none` (no beat to sync). */
export type BeatSync = "required" | "preferred" | "unreliable" | "none";

export type TransitionStyle =
  | "long-blend" // 16-32 bars
  | "medium-blend" // 8-16 bars
  | "short-blend" // 4-8 bars
  | "quick-cut" // 1-2 bars, on a downbeat
  | "echo-out"
  | "fade"
  | "silence-then-start"
  | "vocal-swap"
  | "instrumental-bridge"
  | "scratch-bridge"
  | "filter-sweep"
  | "bass-swap";

export const TRANSITION_STYLES: readonly TransitionStyle[] = [
  "long-blend", "medium-blend", "short-blend", "quick-cut", "echo-out", "fade", "silence-then-start", "vocal-swap", "instrumental-bridge", "scratch-bridge", "filter-sweep", "bass-swap",
];

/** A tool a plan may ask for. Each has its own flag in lib/featureFlags.ts (`roll` shares the stutter flag: a roll is a stutter repeat). */
export type TransitionTool = "scratch" | "stutter" | "roll" | "eq" | "echo" | "instrumentalBridge";

export const TRANSITION_TOOLS: readonly TransitionTool[] = ["scratch", "stutter", "roll", "eq", "echo", "instrumentalBridge"];

export type EnergyHandling = "build" | "sustain" | "contrast";

export interface GenreTransitionRule {
  beatSync: BeatSync;
  /** Best first. */
  preferredStyles: readonly TransitionStyle[];
  /** Bars a blend in this genre may last: [shortest, longest]. Feeds the existing crossfade length as an input only. */
  blendBarsRange: readonly [number, number];
  /** How far apart (in %) two tempos may be before this genre stops accepting a tempo-matched blend. */
  bpmTolerancePct: number;
  /** 0-1: how much a key clash hurts in this genre. */
  keyMatchImportance: number;
  allowedTools: readonly TransitionTool[];
  energyHandling: EnergyHandling;
}

/** What a genre with no entry (or an unknown label) gets: a conservative, short, tool-free-ish mix that works for most songs. */
export const DEFAULT_GENRE_RULE: GenreTransitionRule = {
  beatSync: "preferred",
  preferredStyles: ["short-blend", "quick-cut", "echo-out", "fade"],
  blendBarsRange: [4, 8],
  bpmTolerancePct: 6,
  keyMatchImportance: 0.5,
  allowedTools: ["echo", "eq"],
  energyHandling: "sustain",
};

const rule = (r: GenreTransitionRule): GenreTransitionRule => r;

export const GENRE_TRANSITIONS: Readonly<Record<string, GenreTransitionRule>> = {
  "Hip-Hop": rule({ beatSync: "preferred", preferredStyles: ["quick-cut", "scratch-bridge", "echo-out", "instrumental-bridge", "vocal-swap"], blendBarsRange: [2, 8], bpmTolerancePct: 8, keyMatchImportance: 0.3, allowedTools: ["scratch", "stutter", "roll", "echo", "instrumentalBridge", "eq"], energyHandling: "contrast" }),
  "R&B": rule({ beatSync: "preferred", preferredStyles: ["medium-blend", "vocal-swap", "echo-out"], blendBarsRange: [8, 16], bpmTolerancePct: 6, keyMatchImportance: 0.7, allowedTools: ["echo", "eq", "instrumentalBridge"], energyHandling: "sustain" }),
  Pop: rule({ beatSync: "preferred", preferredStyles: ["short-blend", "quick-cut", "echo-out"], blendBarsRange: [4, 8], bpmTolerancePct: 6, keyMatchImportance: 0.5, allowedTools: ["echo", "eq", "stutter", "roll"], energyHandling: "build" }),
  Rock: rule({ beatSync: "unreliable", preferredStyles: ["quick-cut", "echo-out", "fade"], blendBarsRange: [1, 4], bpmTolerancePct: 3, keyMatchImportance: 0.4, allowedTools: ["echo"], energyHandling: "contrast" }),
  Alternative: rule({ beatSync: "unreliable", preferredStyles: ["quick-cut", "echo-out", "fade"], blendBarsRange: [1, 4], bpmTolerancePct: 3, keyMatchImportance: 0.5, allowedTools: ["echo"], energyHandling: "sustain" }),
  Electronic: rule({ beatSync: "required", preferredStyles: ["long-blend", "bass-swap", "filter-sweep", "medium-blend"], blendBarsRange: [16, 32], bpmTolerancePct: 4, keyMatchImportance: 0.8, allowedTools: ["eq", "stutter", "roll", "echo", "instrumentalBridge"], energyHandling: "build" }),
  Latin: rule({ beatSync: "preferred", preferredStyles: ["medium-blend", "quick-cut", "echo-out"], blendBarsRange: [4, 16], bpmTolerancePct: 8, keyMatchImportance: 0.5, allowedTools: ["eq", "echo", "stutter", "roll", "scratch"], energyHandling: "build" }),
  Country: rule({ beatSync: "unreliable", preferredStyles: ["quick-cut", "short-blend", "echo-out"], blendBarsRange: [2, 8], bpmTolerancePct: 4, keyMatchImportance: 0.5, allowedTools: ["echo"], energyHandling: "sustain" }),
  Jazz: rule({ beatSync: "none", preferredStyles: ["fade", "silence-then-start"], blendBarsRange: [4, 8], bpmTolerancePct: 0, keyMatchImportance: 0.7, allowedTools: ["echo"], energyHandling: "sustain" }),
  Blues: rule({ beatSync: "none", preferredStyles: ["fade", "echo-out", "silence-then-start"], blendBarsRange: [4, 8], bpmTolerancePct: 0, keyMatchImportance: 0.6, allowedTools: ["echo"], energyHandling: "sustain" }),
  Gospel: rule({ beatSync: "unreliable", preferredStyles: ["fade", "medium-blend"], blendBarsRange: [8, 16], bpmTolerancePct: 3, keyMatchImportance: 0.9, allowedTools: ["echo", "eq"], energyHandling: "sustain" }),
  "Reggae/Dancehall": rule({ beatSync: "preferred", preferredStyles: ["medium-blend", "echo-out", "bass-swap"], blendBarsRange: [8, 16], bpmTolerancePct: 6, keyMatchImportance: 0.5, allowedTools: ["echo", "eq", "stutter", "roll", "scratch"], energyHandling: "sustain" }),
  Afrobeats: rule({ beatSync: "preferred", preferredStyles: ["medium-blend", "bass-swap", "echo-out"], blendBarsRange: [8, 16], bpmTolerancePct: 6, keyMatchImportance: 0.9, allowedTools: ["eq", "echo", "stutter", "roll"], energyHandling: "build" }),
  Classical: rule({ beatSync: "none", preferredStyles: ["fade", "silence-then-start"], blendBarsRange: [4, 8], bpmTolerancePct: 0, keyMatchImportance: 0.7, allowedTools: [], energyHandling: "sustain" }),
  Soundtrack: rule({ beatSync: "none", preferredStyles: ["fade", "echo-out", "silence-then-start"], blendBarsRange: [4, 8], bpmTolerancePct: 0, keyMatchImportance: 0.5, allowedTools: ["echo"], energyHandling: "contrast" }),
  Metal: rule({ beatSync: "unreliable", preferredStyles: ["quick-cut", "echo-out"], blendBarsRange: [1, 2], bpmTolerancePct: 3, keyMatchImportance: 0.2, allowedTools: ["echo"], energyHandling: "sustain" }),
  Punk: rule({ beatSync: "unreliable", preferredStyles: ["quick-cut", "echo-out"], blendBarsRange: [1, 2], bpmTolerancePct: 3, keyMatchImportance: 0.2, allowedTools: ["echo"], energyHandling: "sustain" }),
  Folk: rule({ beatSync: "unreliable", preferredStyles: ["fade", "echo-out", "short-blend"], blendBarsRange: [4, 8], bpmTolerancePct: 3, keyMatchImportance: 0.6, allowedTools: ["echo"], energyHandling: "sustain" }),
  Soul: rule({ beatSync: "preferred", preferredStyles: ["medium-blend", "vocal-swap", "echo-out"], blendBarsRange: [8, 16], bpmTolerancePct: 5, keyMatchImportance: 0.7, allowedTools: ["echo", "eq", "instrumentalBridge"], energyHandling: "sustain" }),
  Funk: rule({ beatSync: "preferred", preferredStyles: ["medium-blend", "short-blend", "bass-swap"], blendBarsRange: [4, 16], bpmTolerancePct: 5, keyMatchImportance: 0.5, allowedTools: ["eq", "echo", "stutter", "roll", "scratch"], energyHandling: "build" }),
  Disco: rule({ beatSync: "required", preferredStyles: ["long-blend", "medium-blend", "bass-swap"], blendBarsRange: [8, 32], bpmTolerancePct: 4, keyMatchImportance: 0.7, allowedTools: ["eq", "echo", "stutter", "roll"], energyHandling: "build" }),
  World: rule({ beatSync: "unreliable", preferredStyles: ["fade", "medium-blend", "echo-out"], blendBarsRange: [4, 16], bpmTolerancePct: 4, keyMatchImportance: 0.6, allowedTools: ["echo", "eq"], energyHandling: "sustain" }),
  Holiday: rule({ beatSync: "preferred", preferredStyles: ["short-blend", "quick-cut", "echo-out"], blendBarsRange: [2, 8], bpmTolerancePct: 6, keyMatchImportance: 0.5, allowedTools: ["echo", "eq"], energyHandling: "sustain" }),
  "Children's": rule({ beatSync: "unreliable", preferredStyles: ["fade", "short-blend", "quick-cut"], blendBarsRange: [2, 4], bpmTolerancePct: 4, keyMatchImportance: 0.4, allowedTools: ["echo"], energyHandling: "sustain" }),
  "Spoken Word": rule({ beatSync: "none", preferredStyles: ["fade", "silence-then-start"], blendBarsRange: [1, 2], bpmTolerancePct: 0, keyMatchImportance: 0, allowedTools: [], energyHandling: "sustain" }),
  "Easy Listening": rule({ beatSync: "none", preferredStyles: ["fade", "silence-then-start", "echo-out"], blendBarsRange: [4, 8], bpmTolerancePct: 0, keyMatchImportance: 0.6, allowedTools: ["echo"], energyHandling: "sustain" }),
};

/** The rule for a genre label; the safe default for one with no entry or no label. */
export function genreRule(genre: string | null | undefined): GenreTransitionRule {
  return (genre && Object.hasOwn(GENRE_TRANSITIONS, genre) ? GENRE_TRANSITIONS[genre] : undefined) ?? DEFAULT_GENRE_RULE;
}

/** How the genres' beat reliability sorts (required > preferred > unreliable > none), for how far apart two genres sit. */
const BEAT_ORDER: Record<BeatSync, number> = { required: 3, preferred: 2, unreliable: 1, none: 0 };

/**
 * How far apart two genres sit for MIXING, 0 (the same genre, or nothing known) to 1 (nothing in common): the share of preferred styles they do not
 * share, plus how far apart their beat reliability is. The playlist planners use it as a small cost so same-genre songs cluster when the energy
 * planner's scores are close, and so a big genre jump is a place that wants a bridge or a cut. Unknown genres count as no signal, not as distance.
 */
export function genreFlowDistance(a: string | null | undefined, b: string | null | undefined, table: Readonly<Record<string, GenreTransitionRule>> = GENRE_TRANSITIONS): number {
  if (!a || !b || a === b) return 0;
  if (!Object.hasOwn(table, a) || !Object.hasOwn(table, b)) return 0;
  const ra = table[a], rb = table[b];
  const sa = new Set(ra.preferredStyles), sb = new Set(rb.preferredStyles);
  const shared = [...sa].filter((s) => sb.has(s)).length;
  const union = new Set([...sa, ...sb]).size;
  const styleGap = 1 - shared / union;
  const beatGap = Math.abs(BEAT_ORDER[ra.beatSync] - BEAT_ORDER[rb.beatSync]) / 3;
  return Math.min(1, 0.7 * styleGap + 0.3 * beatGap);
}

/** How much a genre jump between neighbours counts against a playlist order next to its energy miss (the tempo jump's own weight is 0.12). Used only while GENRE_TRANSITIONS_ENABLED is on. */
export const GENRE_FLOW_WEIGHT = 0.12;
