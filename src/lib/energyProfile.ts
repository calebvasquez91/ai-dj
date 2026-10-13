/**
 * A track's energy profile: 100 values (one per 1% of its length, 0-1 each) used to spot peaks and valleys — for the
 * mini energy graph above the waveform and for Auto FX (lib/autoFx.ts).
 *
 * Derived from the waveform peaks every analysis already carries (TrackAnalysis.waveformPeaks), so it works on tracks
 * analysed in earlier sessions with no re-analysis. A track whose energy barely varies gets no profile at all rather
 * than invented peaks (see MIN_SPREAD).
 *
 * Peaks and valleys are PERCENTILES of the track's own energy (see energyZones), not fixed levels: real songs sit near
 * their loudest most of the time, so a fixed "above 0.8" rule made around 60% of an average song a "peak". A peak is
 * now the track's loudest fifth and a valley its quietest fifth, with a small margin so a flat stretch of the same
 * loudness doesn't produce arbitrary ones.
 */

import { resampleBuckets } from "@/lib/resample";

export const ENERGY_PROFILE_POINTS = 100;
/**
 * The loud end (90th percentile) must sit at least this far above the quiet end (10th percentile) of the track's raw
 * 0-1 level. Min-to-max range can't make this call: fade-ins and fade-outs give even a steady track a range near 0.9.
 * Measured on synthetic audio: steady loud track 0.10, mildly varying (+/-10% level between sections) 0.17, a song
 * with intro / drop / breakdown sections 0.83.
 */
const MIN_SPREAD = 0.25;

/** A peak is within the loudest fifth of the track... */
export const PEAK_SHARE = 0.2;
/** ...and a valley within its quietest fifth. */
export const VALLEY_SHARE = 0.2;
/**
 * A peak must also sit at least this far above the track's typical (median) level, and a valley at least this far
 * below it, as a fraction of the track's quietest-to-loudest range. Without it the rank rule would always hand the
 * loudest fifth of a perfectly even stretch the label "peak", and a single loud second in a flat middle would become
 * one.
 */
const ZONE_MARGIN = 0.15;
/** Zones are judged on a short moving average (this many buckets either side), so one noisy bucket can't make a peak. */
const SMOOTHING_RADIUS = 1;

export type EnergyZone = "peak" | "valley" | "mid";

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
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

/**
 * The zone of every point of a profile: "peak" for the loudest fifth (and clearly above the track's typical level),
 * "valley" for the quietest fifth (and clearly below it), "mid" otherwise. `[]` for an empty profile. Because the
 * zones are rank-based, a track can never be mostly peak or mostly valley whatever its overall loudness.
 */
export function energyZones(profile: number[]): EnergyZone[] {
  const n = profile.length;
  if (n === 0) return [];
  const smooth = profile.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - SMOOTHING_RADIUS); j <= Math.min(n - 1, i + SMOOTHING_RADIUS); j++) {
      sum += profile[j];
      count++;
    }
    // rounded so equal values really are equal: (0.1 + 0.1 + 0.1) / 3 is 0.10000000000000002, and rank rules would
    // otherwise split a perfectly even stretch on float noise
    return Math.round((sum / count) * 1e6) / 1e6;
  });
  const sorted = [...smooth].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const peakFrom = quantile(sorted, 1 - PEAK_SHARE);
  const valleyTo = quantile(sorted, VALLEY_SHARE);
  return smooth.map((v) => {
    if (v >= peakFrom && v >= median + ZONE_MARGIN) return "peak";
    if (v <= valleyTo && v <= median - ZONE_MARGIN) return "valley";
    return "mid";
  });
}

/** The zone playback is in at `fraction` (0-1) of the way through the track; null with no zones. */
export function energyZoneAt(zones: EnergyZone[], fraction: number): EnergyZone | null {
  if (zones.length === 0 || !Number.isFinite(fraction)) return null;
  const index = Math.min(zones.length - 1, Math.max(0, Math.floor(fraction * zones.length)));
  return zones[index];
}
