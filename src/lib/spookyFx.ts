/**
 * Random one-shot FX: the player bar's FX button, and (in Spooky Music) the
 * DJ dropping them into the mix by itself. Pure decision logic (which FX,
 * and whether a moment calls for one right now) — the audio itself is played
 * by DualDeckStage.tsx, the same split ambience.ts uses.
 *
 * The pool is every sound in the "Effects" category of the FX Library,
 * whatever its tags — categories like Background (the ambient loops),
 * Transition, Loop and Vocal are left alone — minus anything too long to
 * read as a hit.
 */

import type { FxSound } from "@/types/music";
import type { TrackAnalysis } from "@/lib/audio-analysis";
import { detectBuild, type AmbienceFrequency } from "@/lib/ambience";
import { FX_DEFAULT_LEVEL } from "@/lib/layerMix";

/** Longer than this reads as a backing track, not an effect. */
export const SPOOKY_FX_MAX_SEC = 30;
/** Level before the FX slider scales it (scaledFxGain) — the slider's own default, so the slider reads as the effect's level. */
export const SPOOKY_FX_BASE_GAIN = FX_DEFAULT_LEVEL;
/** How many decoded spooky FX buffers are kept (the lined-up next one plus a couple recent) — decoded PCM is ~11 MB for a 30s stereo clip. */
export const SPOOKY_FX_CACHE_MAX = 3;

/** Min seconds of playback between two DJ-triggered spooky FX, by the ambience-frequency setting. */
const COOLDOWN_SEC: Record<AmbienceFrequency, number> = { off: Infinity, occasional: 45, frequent: 18 };
/** Chance a build-up / drop moment actually gets an FX when it's rolled — rolled at most once per ROLL_INTERVAL_SEC so a 20s build isn't rolled every tick. */
const MOMENT_CHANCE: Record<AmbienceFrequency, { build: number; drop: number }> = {
  off: { build: 0, drop: 0 },
  occasional: { build: 0.6, drop: 0.7 },
  frequent: { build: 0.85, drop: 0.9 },
};
const ROLL_INTERVAL_SEC = 8;
/** "Mainly" at builds and drops, not only: a small per-tick (500ms) chance anywhere else, about once every couple of minutes. */
const WILDCARD_CHANCE_PER_TICK: Record<AmbienceFrequency, number> = { off: 0, occasional: 0.002, frequent: 0.006 };
/** The drop moment: from just before the drop lands to a couple of seconds after. */
const DROP_LEAD_SEC = 0.5;
const DROP_TAIL_SEC = 2;

export function effectsPool(library: FxSound[]): FxSound[] {
  return library.filter((fx) => fx.category === "effect" && fx.durationSec > 0 && fx.durationSec <= SPOOKY_FX_MAX_SEC);
}

/** A random FX from the pool, never the one that just played unless it's the only one. `random` is injectable for tests. */
export function pickRandomFx(pool: FxSound[], lastId: string | null, random: () => number = Math.random): FxSound | null {
  if (pool.length === 0) return null;
  const others = pool.filter((fx) => fx.id !== lastId);
  const choices = others.length > 0 ? others : pool;
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}

export type SpookyMoment = "build" | "drop" | null;

export function spookyMoment({
  analysis,
  durationSec,
  currentTimeSec,
  dropTargetSec,
}: {
  analysis: TrackAnalysis;
  durationSec: number;
  currentTimeSec: number;
  /** The track's next drop (confirmed Hot Cue, else the analysed drop), or null. */
  dropTargetSec: number | null;
}): SpookyMoment {
  if (
    dropTargetSec != null &&
    dropTargetSec > 0 &&
    currentTimeSec >= dropTargetSec - DROP_LEAD_SEC &&
    currentTimeSec < dropTargetSec + DROP_TAIL_SEC
  ) {
    return "drop";
  }
  if (detectBuild(analysis, durationSec, currentTimeSec)) return "build";
  return null;
}

/** Per-track memory for decideSpookyFx. */
export interface SpookyFxState {
  lastPlayedSec: number | null;
  lastRollSec: number | null;
}

export function decideSpookyFx({
  moment,
  currentTimeSec,
  frequency,
  state,
  random = Math.random,
}: {
  moment: SpookyMoment;
  currentTimeSec: number;
  frequency: AmbienceFrequency;
  state: SpookyFxState;
  random?: () => number;
}): { play: boolean; state: SpookyFxState } {
  const idle = { play: false, state };
  if (frequency === "off") return idle;
  // `>= 0` so a seek backwards (negative gap) doesn't lock it out until the playhead catches up.
  const since = (sec: number | null) => (sec == null ? Infinity : currentTimeSec - sec);
  const cooling = since(state.lastPlayedSec) >= 0 && since(state.lastPlayedSec) < COOLDOWN_SEC[frequency];
  if (cooling) return idle;

  if (moment) {
    const sinceRoll = since(state.lastRollSec);
    if (sinceRoll >= 0 && sinceRoll < ROLL_INTERVAL_SEC) return idle;
    const play = random() < MOMENT_CHANCE[frequency][moment];
    return { play, state: { lastRollSec: currentTimeSec, lastPlayedSec: play ? currentTimeSec : state.lastPlayedSec } };
  }
  if (random() < WILDCARD_CHANCE_PER_TICK[frequency]) {
    return { play: true, state: { ...state, lastPlayedSec: currentTimeSec } };
  }
  return idle;
}
