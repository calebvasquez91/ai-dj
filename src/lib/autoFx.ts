/**
 * Auto FX: fire a chosen effect when playback ENTERS an energy peak or valley of the current track
 * (lib/energyProfile.ts). Pure decision logic — DualDeckStage.tsx plays the sound and calls this every tick.
 *
 * "Enters" means the zone changed since the last tick, so:
 *  - a track that starts in a valley (a quiet intro) does not fire at 0:00,
 *  - a seek into the middle of a peak does not fire,
 *  - and turning Auto FX on while a peak is already playing waits for the next one.
 */

import { energyZoneAt, type EnergyZone } from "@/lib/energyProfile";

/** The track's last stretch belongs to the transition and its own FX. */
export const AUTO_FX_TRANSITION_LEAD_SEC = 15;
/** Two auto effects are never closer than this, however jagged the profile. */
export const AUTO_FX_MIN_GAP_SEC = 20;
/** A jump in playback position bigger than this between ticks is a seek, not playback. */
const SEEK_JUMP_SEC = 3;

export interface AutoFxState {
  trackId: string | null;
  lastZone: EnergyZone | null;
  lastTimeSec: number | null;
  lastFiredSec: number | null;
}

export const INITIAL_AUTO_FX_STATE: AutoFxState = { trackId: null, lastZone: null, lastTimeSec: null, lastFiredSec: null };

export interface AutoFxInput {
  enabled: boolean;
  trackId: string;
  profile: number[];
  currentTimeSec: number;
  durationSec: number;
  state: AutoFxState;
}

export function decideAutoFx({
  enabled,
  trackId,
  profile,
  currentTimeSec,
  durationSec,
  state,
}: AutoFxInput): { fire: "peak" | "valley" | null; state: AutoFxState } {
  const zone = durationSec > 0 ? energyZoneAt(profile, currentTimeSec / durationSec) : null;
  const sameTrack = state.trackId === trackId;
  const seeked = state.lastTimeSec == null || Math.abs(currentTimeSec - state.lastTimeSec) > SEEK_JUMP_SEC;
  const next: AutoFxState = {
    trackId,
    lastZone: zone,
    lastTimeSec: currentTimeSec,
    lastFiredSec: sameTrack ? state.lastFiredSec : null,
  };

  if (!enabled || !zone || !sameTrack || seeked) return { fire: null, state: next };
  if (zone === state.lastZone || zone === "mid") return { fire: null, state: next };
  if (durationSec - currentTimeSec <= AUTO_FX_TRANSITION_LEAD_SEC) return { fire: null, state: next };
  // currentTime < lastFiredSec means playback went back past the last firing (a seek the jump check missed): don't let the stale stamp block it.
  const lastFired = state.lastFiredSec;
  if (lastFired != null && currentTimeSec >= lastFired && currentTimeSec - lastFired < AUTO_FX_MIN_GAP_SEC) {
    return { fire: null, state: next };
  }
  return { fire: zone, state: { ...next, lastFiredSec: currentTimeSec } };
}
