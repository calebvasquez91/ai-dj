import { afterEach, describe, expect, it, vi } from "vitest";
import { haptic, hapticsAvailable } from "./haptics";

afterEach(() => vi.unstubAllGlobals());

describe("haptics", () => {
  it("does nothing where the browser cannot vibrate", () => {
    vi.stubGlobal("navigator", {});
    expect(hapticsAvailable()).toBe(false);
    expect(() => haptic()).not.toThrow();
  });

  it("vibrates briefly, a little longer for medium", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    haptic();
    haptic("medium");
    expect(vibrate.mock.calls.map((c) => c[0])).toEqual([8, 16]);
  });

  it("stays silent when the user asked for reduced motion", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(hapticsAvailable()).toBe(false);
    haptic();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("survives a browser that throws", () => {
    vi.stubGlobal("navigator", { vibrate: () => { throw new Error("no activation"); } });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(() => haptic()).not.toThrow();
  });
});
