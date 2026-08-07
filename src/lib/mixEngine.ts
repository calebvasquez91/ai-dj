import type { Track } from "@/types/music";

export const MIN_CROSSFADE_SEC = 3;
export const MAX_CROSSFADE_SEC = 30;
export const DEFAULT_CROSSFADE_SEC = 10;
export const COMPATIBLE_BPM_CROSSFADE_SEC = 20;
export const AUTO_DJ_OFF_FADE_SEC = 3;

const BPM_TOLERANCE = 0.06;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bpmsCompatible(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;
  const ratio = a / b;
  return [ratio, ratio * 2, ratio / 2].some((r) => Math.abs(r - 1) <= BPM_TOLERANCE);
}

/**
 * How long the crossfade between two tracks should be. An explicit user
 * override always wins; otherwise tracks with compatible (matching or
 * double/half) BPMs get a longer, smoother blend, and everything else falls
 * back to a fixed default window.
 */
export function computeCrossfadeWindowSec(
  current: Track,
  next: Track,
  overrideSec: number | null
): number {
  if (overrideSec != null) {
    return clamp(overrideSec, MIN_CROSSFADE_SEC, MAX_CROSSFADE_SEC);
  }
  if (current.bpm && next.bpm && bpmsCompatible(current.bpm, next.bpm)) {
    return COMPATIBLE_BPM_CROSSFADE_SEC;
  }
  return DEFAULT_CROSSFADE_SEC;
}

/** Equal-power crossfade curve: outGain^2 + inGain^2 stays constant at 1. */
export function equalPowerGains(progress: number): {
  outGain: number;
  inGain: number;
} {
  const p = clamp(progress, 0, 1);
  const angle = (p * Math.PI) / 2;
  return { outGain: Math.cos(angle), inGain: Math.sin(angle) };
}
