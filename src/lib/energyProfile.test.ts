import { describe, expect, it } from "vitest";
import {
  ENERGY_PROFILE_POINTS,
  PEAK_THRESHOLD,
  VALLEY_THRESHOLD,
  energyProfileFromPeaks,
  energyZoneAt,
  zoneOfEnergy,
} from "./energyProfile";

/** 240 points: quiet first third, loud middle third, mid last third. */
function threeActs(): number[] {
  return Array.from({ length: 240 }, (_, i) => (i < 80 ? 0.1 : i < 160 ? 0.9 : 0.5));
}

describe("energyProfileFromPeaks", () => {
  it("resamples to 100 values, each 0-1", () => {
    const profile = energyProfileFromPeaks(threeActs());
    expect(profile).toHaveLength(ENERGY_PROFILE_POINTS);
    for (const v of profile) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("stretches to the track's own quietest and loudest (min 0, max 1)", () => {
    const profile = energyProfileFromPeaks(threeActs());
    expect(Math.min(...profile)).toBe(0);
    expect(Math.max(...profile)).toBe(1);
  });

  it("keeps the shape: quiet, loud, then in between", () => {
    const profile = energyProfileFromPeaks(threeActs());
    expect(profile[10]).toBeLessThan(VALLEY_THRESHOLD);
    expect(profile[50]).toBeGreaterThan(PEAK_THRESHOLD);
    expect(profile[90]).toBeGreaterThan(VALLEY_THRESHOLD);
    expect(profile[90]).toBeLessThan(PEAK_THRESHOLD);
  });

  it("averages source points into each bucket, so fast wiggles that cancel out leave no profile", () => {
    const peaks = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 0 : 1)); // 2 points per bucket, each averaging 0.5
    expect(energyProfileFromPeaks(peaks)).toEqual([]);
  });

  it("returns [] for missing, too-short or flat waveform data (no invented peaks)", () => {
    expect(energyProfileFromPeaks([])).toEqual([]);
    expect(energyProfileFromPeaks([0.1, 0.9, 0.2])).toEqual([]);
    expect(energyProfileFromPeaks(new Array(240).fill(0.6))).toEqual([]);
    expect(energyProfileFromPeaks(Array.from({ length: 240 }, (_, i) => 0.5 + (i % 2) * 0.05))).toEqual([]);
  });

  it("treats non-finite source values as silence instead of poisoning the profile", () => {
    const peaks = threeActs();
    peaks[100] = NaN;
    const profile = energyProfileFromPeaks(peaks);
    expect(profile).toHaveLength(ENERGY_PROFILE_POINTS);
    expect(profile.every(Number.isFinite)).toBe(true);
  });
});

describe("zoneOfEnergy / energyZoneAt", () => {
  it("uses the spec thresholds: peak above 0.80, valley below 0.25", () => {
    expect(zoneOfEnergy(0.81)).toBe("peak");
    expect(zoneOfEnergy(0.8)).toBe("mid");
    expect(zoneOfEnergy(0.25)).toBe("mid");
    expect(zoneOfEnergy(0.24)).toBe("valley");
  });

  it("looks up the zone at a fraction of the track, clamped to the ends", () => {
    const profile = energyProfileFromPeaks(threeActs());
    expect(energyZoneAt(profile, 0.05)).toBe("valley");
    expect(energyZoneAt(profile, 0.5)).toBe("peak");
    expect(energyZoneAt(profile, 1)).toBe("mid");
    expect(energyZoneAt(profile, -1)).toBe("valley");
    expect(energyZoneAt(profile, 5)).toBe("mid");
  });

  it("is null with no profile or a non-finite fraction", () => {
    expect(energyZoneAt([], 0.5)).toBeNull();
    expect(energyZoneAt(energyProfileFromPeaks(threeActs()), NaN)).toBeNull();
  });
});
