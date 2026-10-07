/**
 * A track's energy profile: 100 values (one per 1% of its length, 0-1 each) used to spot peaks and valleys — for the
 * mini energy graph above the waveform and for Auto FX (lib/autoFx.ts).
 *
 * Derived from the waveform peaks every analysis already carries (TrackAnalysis.waveformPeaks), so it works on tracks
 * analysed in earlier sessions with no re-analysis. The values are stretched to the track's own quietest-to-loudest
 * range, so "peak" and "valley" mean "loud/quiet for THIS track" — and a track with hardly any dynamic range gets no
 * profile at all rather than invented peaks.
 */

export const ENERGY_PROFILE_POINTS = 100;
/** A point above this is a peak... */
export const PEAK_THRESHOLD = 0.8;
/** ...and one below this is a valley. */
export const VALLEY_THRESHOLD = 0.25;
/** Raw peak values (0-1) must span at least this much, quietest to loudest, for the profile to mean anything. */
const MIN_RAW_RANGE = 0.15;
/** Fewer waveform points than this can't be resampled into a meaningful 100-point profile. */
const MIN_SOURCE_POINTS = 20;

export type EnergyZone = "peak" | "valley" | "mid";

/** 100 energy values (0-1) across the track, or [] when the waveform data is missing, too short or too flat to read. */
export function energyProfileFromPeaks(peaks: number[], points: number = ENERGY_PROFILE_POINTS): number[] {
  if (peaks.length < MIN_SOURCE_POINTS || points < 2) return [];
  const resampled: number[] = [];
  for (let i = 0; i < points; i++) {
    const from = Math.floor((i * peaks.length) / points);
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / points));
    let sum = 0;
    for (let j = from; j < to; j++) sum += Number.isFinite(peaks[j]) ? peaks[j] : 0;
    resampled.push(sum / (to - from));
  }
  const min = Math.min(...resampled);
  const max = Math.max(...resampled);
  if (max - min < MIN_RAW_RANGE) return [];
  return resampled.map((v) => (v - min) / (max - min));
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
