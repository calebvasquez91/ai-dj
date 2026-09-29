import { describe, expect, it } from "vitest";
import { snapToBeatGrid, jumpBeats } from "./beat-grid";

describe("snapToBeatGrid", () => {
  it("snaps to the nearest beat boundary", () => {
    // 120 BPM = 0.5s/beat. Offset 0, so boundaries are at 0, 0.5, 1.0, 1.5...
    expect(snapToBeatGrid(0.72, 0, 120)).toBeCloseTo(0.5, 5);
    expect(snapToBeatGrid(1.3, 0, 120)).toBeCloseTo(1.5, 5);
  });

  it("respects a non-zero grid offset", () => {
    expect(snapToBeatGrid(0.9, 0.2, 120)).toBeCloseTo(0.7, 5);
  });

  it("never returns a negative time", () => {
    expect(snapToBeatGrid(0.1, 5, 120)).toBe(0);
  });

  it("falls back to the raw (clamped) time when bpm is invalid", () => {
    expect(snapToBeatGrid(-3, 0, 0)).toBe(0);
    expect(snapToBeatGrid(7, 0, -10)).toBe(7);
  });
});

describe("jumpBeats", () => {
  it("moves forward by the requested number of beats", () => {
    // 120 BPM = 0.5s/beat
    expect(jumpBeats(10, 120, 4, 240)).toBeCloseTo(12, 5);
  });

  it("moves backward for a negative beat count", () => {
    expect(jumpBeats(10, 120, -4, 240)).toBeCloseTo(8, 5);
  });

  it("clamps at 0 when jumping past the start", () => {
    expect(jumpBeats(1, 120, -8, 240)).toBe(0);
  });

  it("clamps at the track duration when jumping past the end", () => {
    expect(jumpBeats(238, 120, 16, 240)).toBe(240);
  });

  it("falls back to the current (clamped) position when bpm is invalid", () => {
    expect(jumpBeats(50, 0, 4, 240)).toBe(50);
    expect(jumpBeats(-5, 0, 4, 240)).toBe(0);
  });
});
