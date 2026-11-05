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
const PEAK_SHARE = 0.2;
/** ...and a valley within its quietest fifth. */
const VALLEY_SHARE = 0.2;
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
  // The loudest `PEAK_SHARE * n` values are at or above sorted[n - k]; the quietest `VALLEY_SHARE * n` at or below
  // sorted[k - 1]. (Indexing the quiet end with floor(share * n) instead took one value too many.)
  const peakCount = Math.max(1, Math.ceil(n * PEAK_SHARE));
  const valleyCount = Math.max(1, Math.ceil(n * VALLEY_SHARE));
  const peakFrom = sorted[Math.max(0, n - peakCount)];
  const valleyTo = sorted[Math.min(n - 1, valleyCount - 1)];
  return smooth.map((v) => {
    if (v >= peakFrom && v >= median + ZONE_MARGIN) return "peak";
    if (v <= valleyTo && v <= median - ZONE_MARGIN) return "valley";
    return "mid";
  });
}

/**
 * The profile and its zones in one call, so everything that shows or acts on peaks and valleys (the energy graph, Auto
 * FX) takes them from the same place and can't disagree. Both are [] when the track has no usable profile.
 */
export function analyzeEnergy(peaks: number[]): { profile: number[]; zones: EnergyZone[] } {
  const profile = energyProfileFromPeaks(peaks);
  return { profile, zones: energyZones(profile) };
}

/**
 * What Auto FX does when playback moves from zone `prev` to zone `next`: "peak" for entering a peak AND for rising out
 * of a valley back into the body of the track (the drop — in a loud, even song the body is never a "peak", so without
 * this the moment you most want an effect would fire nothing), "valley" for dropping into a valley, otherwise null.
 * No effect without a previous zone: there is nothing to have moved from.
 */
export function zoneEntryEvent(prev: EnergyZone | null, next: EnergyZone | null): "peak" | "valley" | null {
  if (prev == null || next == null || prev === next) return null;
  if (next === "peak") return "peak";
  if (next === "valley") return "valley";
  return prev === "valley" ? "peak" : null; // next is "mid"
}

/** The zone playback is in at `fraction` (0-1) of the way through the track; null with no zones. */
export function energyZoneAt(zones: EnergyZone[], fraction: number): EnergyZone | null {
  if (zones.length === 0 || !Number.isFinite(fraction)) return null;
  const index = Math.min(zones.length - 1, Math.max(0, Math.floor(fraction * zones.length)));
  return zones[index];
}
