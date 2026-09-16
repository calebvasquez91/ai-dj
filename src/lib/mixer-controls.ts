/**
 * Pure math backing the mixer panel's live display of the AI's own mixing.
 * DualDeckStage.tsx reads the real Web Audio automation nodes mix-engine.ts
 * already drives for Auto-DJ transitions and maps their live values through
 * these functions onto the mixer's UI fields — kept here, pure, so the
 * actual number-crunching is unit-testable without a real AudioContext, same
 * pattern as mix-engine.ts's equalPowerGains() (reused directly for the
 * crossfader, not duplicated here).
 */

export const EQ_DB_MIN = -20;
export const EQ_DB_MAX = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampEqDb(db: number): number {
  return clamp(db, EQ_DB_MIN, EQ_DB_MAX);
}

export interface FilterKnobParams {
  type: BiquadFilterType;
  frequency: number;
}

const FILTER_DEADZONE = 0.02;
const FILTER_HIGHPASS_MIN_HZ = 20;
const FILTER_HIGHPASS_MAX_HZ = 8000;
const FILTER_LOWPASS_MAX_HZ = 20000;
const FILTER_LOWPASS_MIN_HZ = 200;

/**
 * Maps a single -1..1 "filter knob" position to a BiquadFilterNode's
 * type/frequency — the classic one-knob DJ-mixer filter: centered (0) is
 * an inaudible bypass, turning right sweeps a highpass up (cutting more
 * bass the further right, log-scaled so it feels even across the sweep),
 * turning left sweeps a lowpass down (cutting more treble the further
 * left). A small deadzone around 0 avoids a barely-off-center knob
 * introducing an audible (if faint) filter.
 */
export function filterKnobToParams(pos: number): FilterKnobParams {
  const p = clamp(pos, -1, 1);
  if (p > FILTER_DEADZONE) {
    const frequency = FILTER_HIGHPASS_MIN_HZ * Math.pow(FILTER_HIGHPASS_MAX_HZ / FILTER_HIGHPASS_MIN_HZ, p);
    return { type: "highpass", frequency };
  }
  if (p < -FILTER_DEADZONE) {
    const frequency = FILTER_LOWPASS_MAX_HZ * Math.pow(FILTER_LOWPASS_MIN_HZ / FILTER_LOWPASS_MAX_HZ, -p);
    return { type: "lowpass", frequency };
  }
  return { type: "allpass", frequency: 0 };
}

/**
 * The inverse of filterKnobToParams — given a BiquadFilterNode's current
 * type/frequency (as mix-engine.ts's transition automation actually sets
 * them), derives the -1..1 knob position the mixer panel displays. Used
 * for read-only display only; nothing feeds this back into the node.
 */
export function filterStateToKnobPos(type: BiquadFilterType, frequency: number): number {
  if (type === "highpass" && frequency > 0) {
    const p = Math.log(frequency / FILTER_HIGHPASS_MIN_HZ) / Math.log(FILTER_HIGHPASS_MAX_HZ / FILTER_HIGHPASS_MIN_HZ);
    return clamp(p, 0, 1);
  }
  if (type === "lowpass" && frequency > 0) {
    const p = -Math.log(frequency / FILTER_LOWPASS_MAX_HZ) / Math.log(FILTER_LOWPASS_MIN_HZ / FILTER_LOWPASS_MAX_HZ);
    return clamp(p, -1, 0);
  }
  return 0;
}
