import { describe, expect, it } from "vitest";
import { AUTO_FX_DEFAULTS, parseAutoFxSettings } from "./autoFxSettings";

describe("parseAutoFxSettings", () => {
  it("is off with random effects by default", () => {
    expect(AUTO_FX_DEFAULTS).toEqual({ enabled: false, peakFx: "random", valleyFx: "random" });
    expect(parseAutoFxSettings(null)).toEqual(AUTO_FX_DEFAULTS);
  });

  it("reads back what was saved", () => {
    const saved = { enabled: true, peakFx: "fx-123", valleyFx: "none" };
    expect(parseAutoFxSettings(JSON.stringify(saved))).toEqual(saved);
  });

  it("falls back field by field for missing or wrong-typed values", () => {
    expect(parseAutoFxSettings(JSON.stringify({ enabled: "yes", peakFx: 5, valleyFx: "fx-9" }))).toEqual({
      enabled: false,
      peakFx: "random",
      valleyFx: "fx-9",
    });
    expect(parseAutoFxSettings(JSON.stringify({ enabled: true }))).toEqual({ enabled: true, peakFx: "random", valleyFx: "random" });
  });

  it("falls back to the defaults for junk", () => {
    expect(parseAutoFxSettings("not json")).toEqual(AUTO_FX_DEFAULTS);
    expect(parseAutoFxSettings("null")).toEqual(AUTO_FX_DEFAULTS);
    expect(parseAutoFxSettings("42")).toEqual(AUTO_FX_DEFAULTS);
    expect(parseAutoFxSettings(JSON.stringify({ peakFx: "x".repeat(500) })).peakFx).toBe("random");
  });
});
