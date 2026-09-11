import { describe, expect, it } from "vitest";
import { computeBpmFromTaps } from "./tapTempo";

describe("computeBpmFromTaps", () => {
  it("returns null with fewer than 2 taps", () => {
    expect(computeBpmFromTaps([])).toBeNull();
    expect(computeBpmFromTaps([1000])).toBeNull();
  });

  it("computes 120 BPM from evenly-spaced 500ms taps", () => {
    expect(computeBpmFromTaps([0, 500, 1000, 1500])).toBe(120);
  });

  it("computes 128 BPM from evenly-spaced taps at that tempo", () => {
    const intervalMs = 60000 / 128;
    const taps = [0, intervalMs, intervalMs * 2, intervalMs * 3, intervalMs * 4];
    expect(computeBpmFromTaps(taps)).toBe(128);
  });

  it("averages slightly uneven intervals rather than requiring exact spacing", () => {
    const bpm = computeBpmFromTaps([0, 490, 1005, 1500]);
    expect(bpm).toBeGreaterThanOrEqual(115);
    expect(bpm).toBeLessThanOrEqual(125);
  });
});
