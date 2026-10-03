import { describe, expect, it } from "vitest";
import {
  AMBIENCE_DEFAULT_LEVEL,
  ambientDuckState,
  clampAmbienceLevel,
  clampFxLevel,
  duckRampSec,
  duckRatio,
  scaledFxGain,
} from "./layerMix";

describe("ambientDuckState", () => {
  it("is normal at the start of a track and outside the energy window", () => {
    expect(ambientDuckState(5, 200, false)).toBe("normal");
    expect(ambientDuckState(0.25 * 200, 200, false)).toBe("normal");
    expect(ambientDuckState(0.7 * 200, 200, false)).toBe("normal");
  });

  it("is energy only inside 30-60% of the track (inclusive edges)", () => {
    expect(ambientDuckState(0.3 * 200, 200, false)).toBe("energy");
    expect(ambientDuckState(0.45 * 200, 200, false)).toBe("energy");
    expect(ambientDuckState(0.6 * 200, 200, false)).toBe("energy");
  });

  it("is transition for the last 15 seconds", () => {
    expect(ambientDuckState(200 - 15, 200, false)).toBe("transition");
    expect(ambientDuckState(199, 200, false)).toBe("transition");
    expect(ambientDuckState(200 - 16, 200, false)).toBe("normal");
  });

  it("is transition for the whole of an active transition, wherever the playhead is", () => {
    expect(ambientDuckState(10, 200, true)).toBe("transition");
  });

  it("is normal when the duration is unknown", () => {
    expect(ambientDuckState(10, 0, false)).toBe("normal");
    expect(ambientDuckState(10, NaN, false)).toBe("normal");
  });
});

describe("duckRatio", () => {
  it("maps 0.15 and 0.08 against the 0.25 default", () => {
    expect(duckRatio("normal")).toBe(1);
    expect(AMBIENCE_DEFAULT_LEVEL * duckRatio("energy")).toBeCloseTo(0.15);
    expect(AMBIENCE_DEFAULT_LEVEL * duckRatio("transition")).toBeCloseTo(0.08);
  });
});

describe("duckRampSec", () => {
  it("takes 5s into a transition and 4s back out, a short ramp otherwise", () => {
    expect(duckRampSec("normal", "transition")).toBe(5);
    expect(duckRampSec("energy", "transition")).toBe(5);
    expect(duckRampSec("transition", "normal")).toBe(4);
    expect(duckRampSec("transition", "energy")).toBe(4);
    expect(duckRampSec("normal", "energy")).toBe(1.5);
    expect(duckRampSec("energy", "normal")).toBe(1.5);
  });

  it("is zero when nothing changes", () => {
    expect(duckRampSec("energy", "energy")).toBe(0);
  });
});

describe("level clamps", () => {
  it("clamps ambience to 0-0.5 and falls back to the default for NaN", () => {
    expect(clampAmbienceLevel(-1)).toBe(0);
    expect(clampAmbienceLevel(0.3)).toBe(0.3);
    expect(clampAmbienceLevel(2)).toBe(0.5);
    expect(clampAmbienceLevel(NaN)).toBe(0.25);
  });

  it("clamps FX to 0-1 and falls back to the default for NaN", () => {
    expect(clampFxLevel(-1)).toBe(0);
    expect(clampFxLevel(1.5)).toBe(1);
    expect(clampFxLevel(NaN)).toBe(0.7);
  });
});

describe("scaledFxGain", () => {
  it("leaves the AI's multiplier untouched at the 0.7 default", () => {
    expect(scaledFxGain(0.5, 0.7)).toBeCloseTo(0.5);
  });

  it("scales with the slider, mutes at 0, and never exceeds full scale", () => {
    expect(scaledFxGain(0.5, 0)).toBe(0);
    expect(scaledFxGain(0.5, 0.35)).toBeCloseTo(0.25);
    expect(scaledFxGain(0.65, 1)).toBeCloseTo(0.9286, 3);
    expect(scaledFxGain(1, 1)).toBe(1);
  });
});
