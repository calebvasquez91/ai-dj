import { describe, expect, it } from "vitest";
import { DJ_MOVE_DEFAULTS, parseDjMoveSettings } from "./djMoveSettings";

describe("parseDjMoveSettings", () => {
  it("gives the defaults for nothing, nonsense or the wrong shape", () => {
    expect(parseDjMoveSettings(null)).toEqual(DJ_MOVE_DEFAULTS);
    expect(parseDjMoveSettings("not json")).toEqual(DJ_MOVE_DEFAULTS);
    expect(parseDjMoveSettings("5")).toEqual(DJ_MOVE_DEFAULTS);
  });
  it("reads what was saved and keeps the rest at the default", () => {
    const s = parseDjMoveSettings(JSON.stringify({ djEq: true, stutterFrequency: 0.9 }));
    expect(s.djEq).toBe(true);
    expect(s.stutterFrequency).toBe(0.9);
    expect(s.scratchVolume).toBe(DJ_MOVE_DEFAULTS.scratchVolume);
  });
  it("starts every switch off, so a person turns each move on in Settings (the genre-aware switch is separate and also starts off)", () => {
    expect(DJ_MOVE_DEFAULTS.djEq).toBe(false);
    expect(DJ_MOVE_DEFAULTS.stutter).toBe(false);
    expect(DJ_MOVE_DEFAULTS.scratch).toBe(false);
    expect(DJ_MOVE_DEFAULTS.autoRadio).toBe(false);
    expect(parseDjMoveSettings(JSON.stringify({ autoRadio: true })).autoRadio).toBe(true);
    expect(parseDjMoveSettings(JSON.stringify({ autoRadio: "yes" })).autoRadio).toBe(false);
  });
  it("keeps sliders between 0 and 1 and ignores values of the wrong type", () => {
    const s = parseDjMoveSettings(JSON.stringify({ stutterFrequency: 5, scratchVolume: -2, scratchFrequency: "loud", djEq: "yes" }));
    expect(s.stutterFrequency).toBe(1);
    expect(s.scratchVolume).toBe(0);
    expect(s.scratchFrequency).toBe(DJ_MOVE_DEFAULTS.scratchFrequency);
    expect(s.djEq).toBe(DJ_MOVE_DEFAULTS.djEq);
  });
});
