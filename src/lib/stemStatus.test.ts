import { describe, expect, it } from "vitest";
import { describeStemStatus } from "./stemStatus";

const counts = { ready: 3, inFlight: 0, failed: 0 };

describe("describeStemStatus", () => {
  it("says plainly that stems can't be made here, with the reason", () => {
    const h = describeStemStatus({ enabled: true, state: "unavailable", message: "local disk", counts });
    expect(h).toEqual({ label: "Stems: unavailable here", detail: "local disk", tone: "warn" });
  });

  it("is on, with how many are ready", () => {
    const h = describeStemStatus({ enabled: true, state: "idle", message: null, counts });
    expect(h.label).toBe("Stems: on · 3 ready");
    expect(h.tone).toBe("ok");
  });

  it("reports none ready yet rather than a bare zero", () => {
    const h = describeStemStatus({ enabled: true, state: "idle", message: null, counts: { ready: 0, inFlight: 0, failed: 0 } });
    expect(h.label).toBe("Stems: on · none ready yet");
  });

  it("shows how many are separating", () => {
    const h = describeStemStatus({ enabled: true, state: "working", message: null, counts: { ready: 1, inFlight: 2, failed: 0 } });
    expect(h.label).toBe("Stems: separating 2… · 1 ready");
    expect(h.tone).toBe("busy");
  });

  it("still says separating while the counts are unknown", () => {
    expect(describeStemStatus({ enabled: true, state: "working", message: null, counts: null }).label).toBe("Stems: separating…");
  });

  it("is off, and says what that means", () => {
    const h = describeStemStatus({ enabled: false, state: "off", message: null, counts });
    expect(h.label).toBe("Stems: off · 3 ready");
    expect(h.tone).toBe("off");
    expect(h.detail).toMatch(/Switch it on/);
  });

  it("carries a pause reason and counts failures", () => {
    const h = describeStemStatus({ enabled: true, state: "paused", message: "budget used up", counts: { ready: 2, inFlight: 0, failed: 1 } });
    expect(h).toEqual({ label: "Stems: paused · 2 ready · 1 failed", detail: "budget used up", tone: "warn" });
  });

  it("does not claim a count before the summary has loaded", () => {
    expect(describeStemStatus({ enabled: true, state: "idle", message: null, counts: null }).label).toBe("Stems: on");
  });
});
