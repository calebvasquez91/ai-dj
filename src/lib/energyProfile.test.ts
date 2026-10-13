import { describe, expect, it } from "vitest";
import {
  ENERGY_PROFILE_POINTS,
  analyzeEnergy,
  energyProfileFromPeaks,
  energyZoneAt,
  energyZones,
  zoneEntryEvent,
  type EnergyZone,
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
    expect(profile[10]).toBeLessThan(0.25);
    expect(profile[50]).toBeGreaterThan(0.8);
    expect(profile[90]).toBeGreaterThan(0.25);
    expect(profile[90]).toBeLessThan(0.8);
  });

  it("averages source points into each bucket, so fast wiggles that cancel out leave no profile", () => {
    const peaks = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 0 : 1)); // 2 points per bucket, each averaging 0.5
    expect(energyProfileFromPeaks(peaks)).toEqual([]);
  });

  it("returns [] for missing or too-short waveform data", () => {
    expect(energyProfileFromPeaks([])).toEqual([]);
    expect(energyProfileFromPeaks([0.1, 0.9, 0.2])).toEqual([]);
    expect(energyProfileFromPeaks(new Array(99).fill(0.5).map((_, i) => (i < 50 ? 0.1 : 0.9)))).toEqual([]); // fewer points than buckets
  });

  it("returns [] for a flat track (no invented peaks)", () => {
    expect(energyProfileFromPeaks(new Array(240).fill(0.6))).toEqual([]);
    expect(energyProfileFromPeaks(Array.from({ length: 240 }, (_, i) => 0.5 + (i % 2) * 0.05))).toEqual([]);
  });

  it("returns [] for a steady track even though its fade-in and fade-out make min-to-max range huge", () => {
    // loud and level throughout, with a near-silent first and last bucket: range ~0.9, but nothing to call a valley
    const peaks = Array.from({ length: 240 }, (_, i) => (i < 3 ? 0.05 : i > 236 ? 0.05 : 0.85 + 0.03 * Math.sin(i)));
    expect(Math.max(...peaks) - Math.min(...peaks)).toBeGreaterThan(0.7);
    expect(energyProfileFromPeaks(peaks)).toEqual([]);
  });

  it("returns [] for a mildly varying, heavily compressed track", () => {
    const peaks = Array.from({ length: 240 }, (_, i) => (i < 80 ? 0.78 : i < 160 ? 0.9 : 0.82));
    expect(energyProfileFromPeaks(peaks)).toEqual([]);
  });

  it("returns [] when one loud spike is the only dynamics", () => {
    const peaks = new Array(240).fill(0.2);
    peaks[120] = 1;
    expect(energyProfileFromPeaks(peaks)).toEqual([]);
  });

  it("still reads a track with real sections even if it fades in and out", () => {
    const peaks = threeActs();
    peaks[0] = 0;
    peaks[239] = 0;
    const profile = energyProfileFromPeaks(peaks);
    expect(profile).toHaveLength(ENERGY_PROFILE_POINTS);
    expect(profile[50]).toBeGreaterThan(0.8);
    expect(profile[10]).toBeLessThan(0.25);
  });

  it("treats non-finite source values as silence instead of poisoning the profile", () => {
    const peaks = threeActs();
    peaks[100] = NaN;
    const profile = energyProfileFromPeaks(peaks);
    expect(profile).toHaveLength(ENERGY_PROFILE_POINTS);
    expect(profile.every(Number.isFinite)).toBe(true);
  });
});

/** Raw waveform-peak shapes, turned into zones the way the app does. */
function zonesOf(peaks: number[]): EnergyZone[] {
  return energyZones(energyProfileFromPeaks(peaks));
}
const share = (zones: EnergyZone[], zone: EnergyZone) => zones.filter((z) => z === zone).length / zones.length;

describe("energyZones", () => {
  it("is empty for an empty profile", () => {
    expect(energyZones([])).toEqual([]);
  });

  it("marks the quiet intro as a valley and the loud middle as a peak in a track with real sections", () => {
    const zones = zonesOf(threeActs());
    expect(zones).toHaveLength(ENERGY_PROFILE_POINTS);
    expect(zones[10]).toBe("valley");
    expect(zones[50]).toBe("peak");
    expect(zones[90]).toBe("mid");
  });

  it("never makes most of a track a peak or a valley, whatever its shape", () => {
    // Ranks: the loudest fifth is the most a track gets, except that a section tied at the extreme (e.g. a breakdown
    // that is one even quiet level for 25% of the song) is included whole. Never anything near a majority.
    const shapes: number[][] = [
      threeActs(),
      Array.from({ length: 240 }, (_, i) => 0.3 + 0.7 * Math.abs(Math.sin(i / 17))),
      Array.from({ length: 240 }, (_, i) => (i < 20 ? 0.1 : i > 220 ? 0.15 : 0.9)), // loud with a fade-in and a fade-out
      Array.from({ length: 240 }, (_, i) => (i % 40 < 10 ? 0.2 : 0.85)),
    ];
    for (const peaks of shapes) {
      const zones = zonesOf(peaks);
      expect(zones.length).toBeGreaterThan(0);
      expect(share(zones, "peak")).toBeLessThanOrEqual(0.35);
      expect(share(zones, "valley")).toBeLessThanOrEqual(0.35);
    }
  });

  it("keeps even stretches whole: no gaps inside a perfectly even section (float noise must not split ties)", () => {
    const zones = zonesOf(threeActs());
    // the quiet first third and the loud middle third are one solid run each
    expect(zones.slice(2, 30).every((z) => z === "valley")).toBe(true);
    expect(zones.slice(38, 60).every((z) => z === "peak")).toBe(true);
  });

  it("does not call most of a loud, mostly-flat song a peak (the fixed-threshold bug on real songs)", () => {
    // 80% of the song sits at one loud level; a quiet intro, a breakdown and an outro are the only dips. A fixed
    // "above 0.8 of the range" rule made ~80% of this a peak.
    const peaks = Array.from({ length: 240 }, (_, i) => {
      if (i < 24) return 0.25; // intro
      if (i >= 100 && i < 124) return 0.3; // breakdown
      if (i >= 216) return 0.2; // outro
      return 0.9 + (i % 3) * 0.005; // loud plateau with a hair of variation
    });
    const zones = zonesOf(peaks);
    expect(zones.length).toBeGreaterThan(0);
    expect(share(zones, "peak")).toBeLessThanOrEqual(0.2);
    // the dips are the valleys; the plateau between them is not
    expect(zones[5]).toBe("valley"); // intro
    expect(zones[48]).toBe("valley"); // breakdown
    expect(zones[95]).toBe("valley"); // outro
    expect(zones[25]).toBe("mid");
    expect(zones[75]).toBe("mid");
  });

  it("finds the one stretch that is clearly louder than the rest of a loud song", () => {
    const peaks = Array.from({ length: 240 }, (_, i) => {
      if (i < 48) return 0.25; // a long quiet intro (so the track has real dynamics)
      if (i >= 150 && i < 190) return 0.99; // the drop
      return 0.8;
    });
    const zones = zonesOf(peaks);
    expect(zones[70]).toBe("peak"); // the drop
    expect(zones[10]).toBe("valley"); // the intro
    expect(zones[40]).toBe("mid"); // the ordinary loud part
  });

  it("calls nothing a peak when the loud part is perfectly even (no stretch stands out)", () => {
    const peaks = Array.from({ length: 240 }, (_, i) => (i < 30 ? 0.2 : i > 210 ? 0.2 : 0.9));
    const zones = zonesOf(peaks);
    expect(zones.filter((z) => z === "peak")).toEqual([]);
    expect(zones.filter((z) => z === "valley").length).toBeGreaterThan(0);
  });

  it("ignores a small bump inside an even stretch, but keeps a clear one", () => {
    const base = (i: number) => (i < 60 ? 0.15 : 0.7); // a quiet start, then an even body
    const small = Array.from({ length: 240 }, (_, i) => (i >= 150 && i < 156 ? base(i) + 0.08 : base(i)));
    const big = Array.from({ length: 240 }, (_, i) => (i >= 150 && i < 190 ? 0.95 : base(i)));
    expect(zonesOf(small).filter((z) => z === "peak")).toEqual([]);
    expect(zonesOf(big)[70]).toBe("peak");
  });
});

describe("energyZoneAt", () => {
  it("looks up the zone at a fraction of the track, clamped to the ends", () => {
    const zones = zonesOf(threeActs());
    expect(energyZoneAt(zones, 0.05)).toBe("valley");
    expect(energyZoneAt(zones, 0.5)).toBe("peak");
    expect(energyZoneAt(zones, 1)).toBe("mid");
    expect(energyZoneAt(zones, -1)).toBe("valley");
    expect(energyZoneAt(zones, 5)).toBe("mid");
  });

  it("is null with no zones or a non-finite fraction", () => {
    expect(energyZoneAt([], 0.5)).toBeNull();
    expect(energyZoneAt(zonesOf(threeActs()), NaN)).toBeNull();
  });
});

describe("energyZones shares are exact", () => {
  it("gives a strictly rising track exactly a fifth peak and a fifth valley (no off-by-one on either end)", () => {
    const ramp = Array.from({ length: 100 }, (_, i) => i / 99);
    const zones = energyZones(ramp);
    expect(zones.filter((z) => z === "peak")).toHaveLength(20);
    expect(zones.filter((z) => z === "valley")).toHaveLength(20);
    expect(zones[99]).toBe("peak");
    expect(zones[0]).toBe("valley");
  });
});

describe("zoneEntryEvent", () => {
  it("fires 'peak' on entering a peak and 'valley' on entering a valley", () => {
    expect(zoneEntryEvent("mid", "peak")).toBe("peak");
    expect(zoneEntryEvent("valley", "peak")).toBe("peak");
    expect(zoneEntryEvent("mid", "valley")).toBe("valley");
    expect(zoneEntryEvent("peak", "valley")).toBe("valley");
  });

  it("fires 'peak' on rising out of a valley into the body (the drop)", () => {
    expect(zoneEntryEvent("valley", "mid")).toBe("peak");
  });

  it("does nothing for staying put, settling out of a peak, or having no previous zone", () => {
    expect(zoneEntryEvent("mid", "mid")).toBeNull();
    expect(zoneEntryEvent("peak", "peak")).toBeNull();
    expect(zoneEntryEvent("peak", "mid")).toBeNull();
    expect(zoneEntryEvent(null, "peak")).toBeNull();
    expect(zoneEntryEvent("mid", null)).toBeNull();
  });
});

describe("analyzeEnergy", () => {
  it("returns the profile and the zones together, from one source", () => {
    const { profile, zones } = analyzeEnergy(threeActs());
    expect(profile).toEqual(energyProfileFromPeaks(threeActs()));
    expect(zones).toEqual(energyZones(profile));
  });

  it("is empty on both for a track with no usable profile", () => {
    expect(analyzeEnergy([])).toEqual({ profile: [], zones: [] });
    expect(analyzeEnergy(new Array(240).fill(0.6))).toEqual({ profile: [], zones: [] });
  });
});
