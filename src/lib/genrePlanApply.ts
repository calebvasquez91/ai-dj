/**
 * Hands a genre-aware plan to the EXISTING transition engine. The genre layer only chooses which transition to ask for; it does it through
 * the inputs planTransition() already takes (a pinned transition id, a crossfade length), never by touching the sync engine, the morph, the
 * phase lock, the master clock or the audio op queue.
 *
 *  - A beat-synced blend (long / medium / short blend, bass swap, filter sweep) is handed over UNCHANGED: the same arguments the engine
 *    gets today, so the SyncReport and the morph and crossfade schedule are identical. blendBarsRange therefore does not alter the existing
 *    crossfade length (an altered length would break "same schedule as today"); it shapes which style is chosen instead.
 *  - echo-out and silence-then-start pin the engine's own "echo-out" transition (which echoes into silence, holds 3-5 s and starts the next song
 *    at its peak).
 *  - quick-cut and fade become a SHORT phrase-blend of the planned length. The engine never hard-cuts: Hard Cut and Quick Chop are switched off
 *    by the owner's choice (data/transitions.ts: "no sudden stops, ever"), so the shortest executable overlap stands in for a cut.
 *  - Bridges and a vocal swap are advisory here: the scratch and instrumental bridges are planned and tested but not yet handed to the
 *    transition engine, and the vocal swap belongs to the vocal-split phase. The plan is logged and shown; the arguments are unchanged.
 *
 * A pinned transition (the person's own pick) always wins.
 */
import type { PlanTransitionArgs } from "@/lib/mix-engine";
import type { GenreTransitionPlan } from "@/lib/transitionPlanner";

/** The plan for one upcoming pair, with the DJ's note. Stored in the player store and read by planArgsFromState. */
export interface PairGenrePlan {
  fromId: string;
  toId: string;
  plan: GenreTransitionPlan;
  /** The Engineer's mixability score for the pair, 0-1. */
  mixability: number;
  /** The Engineer's vetoes for the pair: a style and why. */
  vetoes: { style: string; reason: string }[];
  decidedBy: "local" | "claude" | "local-fallback";
  /** One sentence: the DJ's reason. */
  reason: string;
  /** The full readout line: "Hip-Hop to R&B: quick-cut with echo-out. Reason: tempo gap of 14 BPM." */
  readout: string;
}

/** The engine's own echo-out transition (lib/echoOut.ts ECHO_OUT_TRANSITION_ID; repeated here so this file, which mix-engine imports, stays free of import cycles). */
const ECHO_OUT_TRANSITION_ID = "echo-out";

/** The engine's shortest executable overlap: a phrase blend (a hard cut is switched off). */
export const SHORT_BLEND_TRANSITION_ID = "phrase-blend";

/** No window shorter than this: under a couple of seconds a blend is a click, not a mix. */
export const MIN_SHORT_WINDOW_SEC = 2;

/** Whether a plan is a beat-synced blend that the sync pipeline must receive unchanged. */
export function isBeatSyncedBlend(plan: Pick<GenreTransitionPlan, "style">): boolean {
  return plan.style === "long-blend" || plan.style === "medium-blend" || plan.style === "short-blend" || plan.style === "bass-swap" || plan.style === "filter-sweep";
}

/** Seconds that `bars` bars last at `bpm` (4 beats a bar). */
export function barsToSec(bars: number, bpm: number): number {
  return (bars * 4 * 60) / (bpm > 0 ? bpm : 120);
}

/** True when `plan` was made for exactly this upcoming pair. */
export function planMatchesPair(pair: Pick<PairGenrePlan, "fromId" | "toId"> | null | undefined, currentId: string, nextId: string): boolean {
  return pair != null && pair.fromId === currentId && pair.toId === nextId;
}

/** planTransition's arguments with the genre plan applied. Returns `args` itself (same object) whenever nothing should change. */
export function adjustPlanArgsForGenrePlan(args: PlanTransitionArgs, plan: GenreTransitionPlan): PlanTransitionArgs {
  if (args.forceTransitionId) return args; // the person's own pick wins
  if (isBeatSyncedBlend(plan)) return args; // the sync pipeline gets exactly what it gets today
  switch (plan.style) {
    case "echo-out":
    case "silence-then-start":
      return { ...args, forceTransitionId: ECHO_OUT_TRANSITION_ID };
    case "quick-cut":
    case "fade": {
      const sec = Math.max(MIN_SHORT_WINDOW_SEC, barsToSec(plan.bars, args.current.analysis.bpm));
      return { ...args, forceTransitionId: SHORT_BLEND_TRANSITION_ID, overrideSec: args.overrideSec ?? sec };
    }
    default:
      return args; // bridges and a vocal swap: advisory for now
  }
}

/** The styles the engine performs with its own pinned transition instead of the Song Sync morph. */
const NON_SYNC_PERFORMED: ReadonlySet<string> = new Set(["echo-out", "silence-then-start", "quick-cut", "fade"]);

/**
 * True when Song Sync's automatic morph should stand aside for this pair: the genre plan chose a style the engine performs on its own (an echo-out,
 * a cut or a fade), so a morph would override it. False whenever the flag is off, there is no plan for exactly this pair, or the plan is a beat-synced
 * blend (the morph then runs exactly as today).
 */
export function genrePlanSkipsSongSync(enabled: boolean, pair: PairGenrePlan | null | undefined, currentId: string, nextId: string): boolean {
  return enabled && planMatchesPair(pair, currentId, nextId) && NON_SYNC_PERFORMED.has(pair!.plan.style);
}
