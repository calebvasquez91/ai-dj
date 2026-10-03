/**
 * Pure rules for the Halloween ambient loop's level — kept out of
 * DualDeckStage.tsx so they're unit-testable without an AudioContext.
 *
 * The loop sits under the music at a base level the user sets with the
 * "Ambience" slider (default 0.25). On top of that it ducks out of the way:
 *  - "energy": mid-track, where the song is assumed to peak (30–60% of its
 *    length), the loop drops to 0.15 of the 0.25 default — a 0.6 ratio.
 *  - "transition": over the track's last 15 seconds, and for the whole
 *    transition, it drops to 0.08 of the 0.25 default — a 0.32 ratio — so it
 *    gets out of the way of the transition FX without disappearing.
 * The ratios (not absolute levels) are what's stored, so the Ambience slider
 * scales the ducked levels too.
 */

export const AMBIENCE_DEFAULT_LEVEL = 0.25;
export const AMBIENCE_MAX_LEVEL = 0.5;
export const FX_DEFAULT_LEVEL = 0.7;
export const FX_MAX_LEVEL = 1;

/** Approximate energy peak, as a fraction of the track — no real per-section energy is available here. */
export const ENERGY_WINDOW_START = 0.3;
export const ENERGY_WINDOW_END = 0.6;
/** Seconds before a track's end at which the loop starts getting out of the way of the transition. */
export const TRANSITION_LEAD_SEC = 15;

const ENERGY_DUCK_RATIO = 0.15 / AMBIENCE_DEFAULT_LEVEL;
const TRANSITION_DUCK_RATIO = 0.08 / AMBIENCE_DEFAULT_LEVEL;

/** Ramp lengths: down into a transition 5s, back up after the next song starts 4s, anything else a short 1.5s. */
const RAMP_INTO_TRANSITION_SEC = 5;
const RAMP_OUT_OF_TRANSITION_SEC = 4;
const RAMP_DEFAULT_SEC = 1.5;

export type AmbientDuckState = "normal" | "energy" | "transition";

export function ambientDuckState(
  positionSec: number,
  durationSec: number,
  transitioning: boolean
): AmbientDuckState {
  if (transitioning) return "transition";
  if (!Number.isFinite(durationSec) || durationSec <= 0) return "normal";
  if (durationSec - positionSec <= TRANSITION_LEAD_SEC) return "transition";
  const ratio = positionSec / durationSec;
  if (ratio >= ENERGY_WINDOW_START && ratio <= ENERGY_WINDOW_END) return "energy";
  return "normal";
}

export function duckRatio(state: AmbientDuckState): number {
  if (state === "transition") return TRANSITION_DUCK_RATIO;
  if (state === "energy") return ENERGY_DUCK_RATIO;
  return 1;
}

export function duckRampSec(from: AmbientDuckState, to: AmbientDuckState): number {
  if (from === to) return 0;
  if (to === "transition") return RAMP_INTO_TRANSITION_SEC;
  if (from === "transition") return RAMP_OUT_OF_TRANSITION_SEC;
  return RAMP_DEFAULT_SEC;
}

export function clampAmbienceLevel(level: number): number {
  if (!Number.isFinite(level)) return AMBIENCE_DEFAULT_LEVEL;
  return Math.min(AMBIENCE_MAX_LEVEL, Math.max(0, level));
}

export function clampFxLevel(level: number): number {
  if (!Number.isFinite(level)) return FX_DEFAULT_LEVEL;
  return Math.min(FX_MAX_LEVEL, Math.max(0, level));
}

/** Gain for a transition FX: the AI's own (already capped) multiplier, scaled by the FX slider relative to its 0.7 default, never above full scale. */
export function scaledFxGain(aiVolumeMultiplier: number, fxLevel: number): number {
  const scaled = Math.max(0, aiVolumeMultiplier) * (clampFxLevel(fxLevel) / FX_DEFAULT_LEVEL);
  return Math.min(1, scaled);
}
