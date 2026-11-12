/**
 * Turning the engineer's proposals into a plan the player can run, and deciding, tick by tick, when to schedule the
 * next planned effect. Pure, so the timing rules can be tested; DualDeckStage.tsx owns the audio.
 *
 * The plan is made once per song (lib/fxPlanClient.ts asks the DJ). Playing it is a matter of the playhead: an effect is
 * decoded ahead of time, then scheduled on the audio clock a moment before it is due, from the deck's own position, so
 * it starts exactly on the beat the engineer chose rather than "when the tick happened to run".
 */

import {
  findFxCues,
  proposeFx,
  type FxCue,
  type FxCueKind,
  type FxProposal,
  type FxRole,
} from "@/lib/fxCues";
import { applyFxPicks, type FxPlanCandidate, type FxPlanFrequency, type FxPlanInput, type FxPlanReview } from "@/lib/ai-fx-plan";
import type { SongMap } from "@/lib/song-map";
import type { VoiceMap } from "@/lib/voiceMap";
import type { FxSound } from "@/types/music";

/** One effect, decided: which sound, from where to where in the song, and at what speed. */
export interface PlannedFx {
  id: string;
  fx: FxSound;
  role: FxRole;
  cueKind: FxCueKind;
  startSec: number;
  endSec: number;
  /** Playback rate of the sound (1 = its own speed), for matching its tempo to the song's. */
  rate: number;
  /** Why it is there, in the DJ's words when the DJ gave one, else the engineer's. */
  note: string;
}

/** Schedule an effect when it is due within this many seconds of song time... */
export const FX_SCHEDULE_AHEAD_SEC = 3;
/** ...but not later than this: there must be time to read the clock, schedule and let the audio thread take it. */
export const FX_MIN_LEAD_SEC = 0.35;
/** Start decoding an effect this long before it is due (a decoded 30 s sound is ~11 MB, so not much earlier). */
export const FX_PREFETCH_AHEAD_SEC = 25;
/** Nothing is proposed for the first moments after a plan starts: its sounds must be decoded and scheduled in time. */
export const FX_PLAN_LEAD_SEC = 4;

export interface BuiltFxPlan {
  input: FxPlanInput;
  /** Candidate id -> the planned effect it would become. */
  byId: Map<string, PlannedFx>;
}

export interface BuildFxPlanArgs {
  title: string;
  songMap: SongMap | null | undefined;
  voiceMap?: VoiceMap | null;
  durationSec: number;
  /** The playhead when the plan is made. */
  fromSec: number;
  frequency: FxPlanFrequency;
  spooky: boolean;
  /** The sounds that may be used here (Effects, already through getEligibleFX). */
  pool: FxSound[];
  recentFxIds?: string[];
}

function candidateFor(proposal: FxProposal, cue: FxCue | undefined, fx: FxSound): FxPlanCandidate {
  return {
    id: `${proposal.cueId}|${proposal.fxId}`,
    cueKind: proposal.kind,
    cueAtSec: cue?.atSec ?? proposal.placement.startSec,
    startSec: proposal.placement.startSec,
    endSec: proposal.placement.endSec,
    role: proposal.role,
    fxName: fx.name,
    score: proposal.score,
    vocalOverlap: cue?.vocalOverlap ?? 0,
    reason: proposal.reason,
  };
}

/** The engineer's side of one song: its cues, the sounds that fit them, and the candidate list the DJ chooses from. Null when there is nothing to choose (no trustworthy grid, no cue, no sound that fits). */
export function buildFxPlan(args: BuildFxPlanArgs): BuiltFxPlan | null {
  const cues = findFxCues({
    songMap: args.songMap,
    voiceMap: args.voiceMap,
    durationSec: args.durationSec,
    fromSec: args.fromSec + FX_PLAN_LEAD_SEC,
  });
  if (cues.length === 0 || !args.songMap) return null;
  // Ask for the roomiest plan; the DJ (and applyFxPicks) trim it to the frequency the listener set.
  const proposals = proposeFx({
    cues,
    pool: args.pool,
    songMap: args.songMap,
    frequency: "frequent",
    recentFxIds: args.recentFxIds,
    random: () => 0.5,
  });
  if (proposals.length === 0) return null;

  const cueById = new Map(cues.map((c) => [c.id, c]));
  const fxById = new Map(args.pool.map((fx) => [fx.id, fx]));
  const candidates: FxPlanCandidate[] = [];
  const byId = new Map<string, PlannedFx>();
  for (const proposal of proposals) {
    const fx = fxById.get(proposal.fxId);
    if (!fx) continue;
    const candidate = candidateFor(proposal, cueById.get(proposal.cueId), fx);
    candidates.push(candidate);
    byId.set(candidate.id, {
      id: candidate.id,
      fx,
      role: proposal.role,
      cueKind: proposal.kind,
      startSec: proposal.placement.startSec,
      endSec: proposal.placement.endSec,
      rate: proposal.placement.rate,
      note: proposal.reason,
    });
  }
  if (candidates.length === 0) return null;
  return {
    input: {
      title: args.title,
      bpm: args.songMap.bpm,
      durationSec: args.durationSec,
      frequency: args.frequency,
      spooky: args.spooky,
      candidates,
    },
    byId,
  };
}

/** The DJ's review (or the engineer's own pick) as the plan to run: only picks that pass the rules, in song order, each with the DJ's note. */
export function planFromReview(built: BuiltFxPlan, review: Pick<FxPlanReview, "picks">): PlannedFx[] {
  const notes = new Map(review.picks.map((p) => [p.id, p.note]));
  const chosen = applyFxPicks(built.input, review.picks.map((p) => p.id));
  const planned: PlannedFx[] = [];
  for (const candidate of chosen) {
    const item = built.byId.get(candidate.id);
    if (!item) continue;
    planned.push({ ...item, note: notes.get(candidate.id) || item.note });
  }
  return planned;
}

export interface FxSchedulerDecision {
  /** Due now: start it, on the clock, at the delay given. */
  schedule: { item: PlannedFx; delaySec: number } | null;
  /** Coming up: begin decoding it. */
  prefetch: PlannedFx | null;
}

/**
 * What to do about the plan on this tick. `currentSec` is the deck's position and `playbackRate` its speed (the
 * delay on the audio clock is the song-time distance over the rate). Effects already scheduled (`done`) and ones whose
 * moment has passed are skipped.
 */
export function nextFxToSchedule(
  plan: readonly PlannedFx[],
  currentSec: number,
  done: ReadonlySet<string>,
  playbackRate = 1
): FxSchedulerDecision {
  const rate = playbackRate > 0 ? playbackRate : 1;
  let schedule: FxSchedulerDecision["schedule"] = null;
  let prefetch: PlannedFx | null = null;
  for (const item of plan) {
    if (done.has(item.id)) continue;
    const delaySec = (item.startSec - currentSec) / rate;
    if (delaySec < FX_MIN_LEAD_SEC) continue; // already past, or too close to start cleanly
    if (delaySec <= FX_SCHEDULE_AHEAD_SEC) {
      schedule = { item, delaySec };
      break;
    }
    if (delaySec <= FX_PREFETCH_AHEAD_SEC && !prefetch) prefetch = item;
  }
  return { schedule, prefetch };
}
