import { describe, expect, it } from "vitest";
import type { FxSound } from "@/types/music";
import { AUTO_FX_DEFAULTS, effectiveAutoFxChoice, parseAutoFxSettings } from "./autoFxSettings";

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

describe("effectiveAutoFxChoice", () => {
  const pool = [{ id: "fx-1" }, { id: "fx-2" }] as FxSound[];

  it("keeps none, random and any sound still in the pool", () => {
    expect(effectiveAutoFxChoice("none", pool)).toBe("none");
    expect(effectiveAutoFxChoice("random", pool)).toBe("random");
    expect(effectiveAutoFxChoice("fx-2", pool)).toBe("fx-2");
  });

  it("falls back to random for a sound that was deleted or is no longer an Effects sound", () => {
    expect(effectiveAutoFxChoice("fx-gone", pool)).toBe("random");
    expect(effectiveAutoFxChoice("fx-1", [])).toBe("random");
  });
});
