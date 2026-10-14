import { describe, expect, it } from "vitest";
import { AUTOPILOT_MAX_IN_FLIGHT, planStemAutopilot, stemStateFromJob, type StemJobState } from "./stemAutopilot";
import type { StemVerdict } from "./stemPlanner";

const verdict = (trackId: string, worthIt: boolean): StemVerdict => ({
  trackId,
  score: worthIt ? 80 : 10,
  worthIt,
  reasons: [],
  roles: [],
});

function plan(
  verdicts: StemVerdict[],
  states: Record<string, StemJobState | undefined> = {},
  inFlight = 0,
  maxInFlight?: number
) {
  return planStemAutopilot({ verdicts, states, inFlight, maxInFlight });
}

describe("planStemAutopilot", () => {
  it("starts the nearest worthwhile track that has no job", () => {
    const p = plan([verdict("a", true), verdict("b", true)], { a: "none", b: "none" });
    expect(p.start).toBe("a");
  });

  it("asks to look up tracks it knows nothing about before deciding", () => {
    const p = plan([verdict("a", true), verdict("b", true)]);
    expect(p).toEqual({ check: ["a", "b"], start: null });
  });

  it("skips tracks the engineer does not want, without looking them up", () => {
    const p = plan([verdict("a", false), verdict("b", true)], { b: "none" });
    expect(p).toEqual({ check: [], start: "b" });
  });

  it("does not start a job that is already running, ready, or failed", () => {
    const p = plan([verdict("a", true), verdict("b", true), verdict("c", true)], { a: "processing", b: "ready", c: "failed" });
    expect(p.start).toBeNull();
  });

  it("never retries a failed job by itself", () => {
    expect(plan([verdict("a", true)], { a: "failed" }).start).toBeNull();
  });

  it("goes to the next worthwhile track when the nearest is already done", () => {
    const p = plan([verdict("a", true), verdict("b", true)], { a: "ready", b: "none" });
    expect(p.start).toBe("b");
  });

  it("starts nothing while at the in-flight limit", () => {
    expect(plan([verdict("a", true)], { a: "none" }, AUTOPILOT_MAX_IN_FLIGHT).start).toBeNull();
    expect(plan([verdict("a", true)], { a: "none" }, 1, 2).start).toBe("a");
  });

  it("starts at most one track per planning round", () => {
    const p = plan([verdict("a", true), verdict("b", true), verdict("c", true)], { a: "none", b: "none", c: "none" }, 0, 5);
    expect(p.start).toBe("a");
  });

  it("can ask for lookups and start in the same round", () => {
    const p = plan([verdict("a", true), verdict("b", true)], { a: "none" });
    expect(p).toEqual({ check: ["b"], start: "a" });
  });

  it("handles an empty window", () => {
    expect(plan([])).toEqual({ check: [], start: null });
  });
});

describe("stemStateFromJob", () => {
  it("maps a server job to a state", () => {
    expect(stemStateFromJob(null)).toBe("none");
    expect(stemStateFromJob(undefined)).toBe("none");
    expect(stemStateFromJob({ status: "ready" })).toBe("ready");
    expect(stemStateFromJob({ status: "failed" })).toBe("failed");
    expect(stemStateFromJob({ status: "processing" })).toBe("processing");
    expect(stemStateFromJob({ status: "pending" })).toBe("processing");
  });
});
