/**
 * A track's energy profile: 100 values (one per 1% of its length, 0-1 each) used to spot peaks and valleys — for the
 * mini energy graph above the waveform and for Auto FX (lib/autoFx.ts).
 *
 * Derived from the waveform peaks every analysis already carries (TrackAnalysis.waveformPeaks), so it works on tracks
 * analysed in earlier sessions with no re-analysis. The values are stretched to the track's own quietest-to-loudest
 * range, so "peak" and "valley" mean "loud/quiet for THIS track". That only means something when the track really
 * has loud and quiet stretches, so a track whose energy barely varies gets no profile at all rather than invented
 * peaks (see MIN_SPREAD).
 */

import { resampleBuckets } from "@/lib/resample";

export const ENERGY_PROFILE_POINTS = 100;
/** A point above this is a peak... */
export const PEAK_THRESHOLD = 0.8;
/** ...and one below this is a valley. */
export const VALLEY_THRESHOLD = 0.25;
/**
 * The loud end (90th percentile) must sit at least this far above the quiet end (10th percentile) of the track's raw
 * 0-1 level. Min-to-max range can't make this call: fade-ins and fade-outs give even a steady track a range near 0.9.
 * Measured on synthetic audio: steady loud track 0.10, mildly varying (+/-10% level between sections) 0.17, a song
 * with intro / drop / breakdown sections 0.83.
 */
const MIN_SPREAD = 0.25;

export type EnergyZone = "peak" | "valley" | "mid";

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** 100 energy values (0-1) across the track, or [] when the waveform data is missing, too short or too even to read. */
export function energyProfileFromPeaks(peaks: number[], points: number = ENERGY_PROFILE_POINTS): number[] {
  if (points < 2 || peaks.length < points) return [];
  const levels = resampleBuckets(peaks, points, "mean");
  const sorted = [...levels].sort((a, b) => a - b);
  if (quantile(sorted, 0.9) - quantile(sorted, 0.1) < MIN_SPREAD) return [];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return levels.map((v) => (v - min) / (max - min));
}

/** Which zone one profile value falls in. */
export function zoneOfEnergy(value: number): EnergyZone {
  if (value > PEAK_THRESHOLD) return "peak";
  if (value < VALLEY_THRESHOLD) return "valley";
  return "mid";
}

/** The zone playback is in at `fraction` (0-1) of the way through the track; null with no profile. */
export function energyZoneAt(profile: number[], fraction: number): EnergyZone | null {
  if (profile.length === 0 || !Number.isFinite(fraction)) return null;
  const index = Math.min(profile.length - 1, Math.max(0, Math.floor(fraction * profile.length)));
  return zoneOfEnergy(profile[index]);
}
