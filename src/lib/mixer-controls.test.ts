import { describe, expect, it } from "vitest";
import {
  clampEqDb,
  filterKnobToParams,
  filterStateToKnobPos,
  EQ_DB_MAX,
  EQ_DB_MIN,
} from "./mixer-controls";

describe("clampEqDb", () => {
  it("passes values already in range through unchanged", () => {
    expect(clampEqDb(-4)).toBe(-4);
  });

  it("clamps to the documented min/max", () => {
    expect(clampEqDb(999)).toBe(EQ_DB_MAX);
    expect(clampEqDb(-999)).toBe(EQ_DB_MIN);
  });
});

describe("filterKnobToParams", () => {
  it("is an inaudible allpass at center", () => {
    expect(filterKnobToParams(0)).toEqual({ type: "allpass", frequency: 0 });
  });

  it("stays allpass within the small center deadzone", () => {
    expect(filterKnobToParams(0.01).type).toBe("allpass");
    expect(filterKnobToParams(-0.01).type).toBe("allpass");
  });

  it("sweeps a highpass upward as the knob turns right, maxing at full-right", () => {
    const quarter = filterKnobToParams(0.5);
    const full = filterKnobToParams(1);
    expect(quarter.type).toBe("highpass");
    expect(full.type).toBe("highpass");
    expect(full.frequency).toBeGreaterThan(quarter.frequency);
    expect(full.frequency).toBeCloseTo(8000, 0);
  });

  it("sweeps a lowpass downward as the knob turns left, mininum at full-left", () => {
    const quarter = filterKnobToParams(-0.5);
    const full = filterKnobToParams(-1);
    expect(quarter.type).toBe("lowpass");
    expect(full.type).toBe("lowpass");
    expect(full.frequency).toBeLessThan(quarter.frequency);
    expect(full.frequency).toBeCloseTo(200, 0);
  });

  it("clamps positions outside -1..1", () => {
    expect(filterKnobToParams(5)).toEqual(filterKnobToParams(1));
    expect(filterKnobToParams(-5)).toEqual(filterKnobToParams(-1));
  });
});

describe("filterStateToKnobPos", () => {
  it("is the inverse of filterKnobToParams across the highpass sweep", () => {
    for (const pos of [0.1, 0.25, 0.5, 0.75, 1]) {
      const { type, frequency } = filterKnobToParams(pos);
      expect(filterStateToKnobPos(type, frequency)).toBeCloseTo(pos, 5);
    }
  });

  it("is the inverse of filterKnobToParams across the lowpass sweep", () => {
    for (const pos of [-0.1, -0.25, -0.5, -0.75, -1]) {
      const { type, frequency } = filterKnobToParams(pos);
      expect(filterStateToKnobPos(type, frequency)).toBeCloseTo(pos, 5);
    }
  });

  it("reports an allpass (or any other neutral type) as centered", () => {
    expect(filterStateToKnobPos("allpass", 0)).toBe(0);
    expect(filterStateToKnobPos("peaking", 1000)).toBe(0);
  });
});
