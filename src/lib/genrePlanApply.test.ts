import { describe, expect, it } from "vitest";
import { fallbackAnalysis, type TrackAnalysis } from "./audio-analysis-core";
import { adjustPlanArgsForGenrePlan, barsToSec, genrePlanSkipsSongSync, isBeatSyncedBlend, planMatchesPair, type PairGenrePlan } from "./genrePlanApply";
import { planArgsFromState, planTransition, type PlanningState } from "./mix-engine";
import { buildSyncReport } from "./syncEngine";
import type { GenreTransitionPlan } from "./transitionPlanner";
import type { TransitionStyle } from "./genreTransitions";

const analysis = (over: Partial<TrackAnalysis> = {}): TrackAnalysis => ({ ...fallbackAnalysis(), fallback: false, bpm: 124, bpmConfidence: 0.9, key: "A minor", camelotKey: "8A", keyConfidence: 0.8, energyOnsetSec: 8, waveformPeaks: Array.from({ length: 200 }, (_, i) => 0.3 + 0.4 * Math.abs(Math.sin(i / 9))), ...over });
const track = (id: string) => ({ id, title: id, artist: "x", durationSec: 200, source: "local" as const, sourceUrl: `blob:${id}` }) as never;

const state: PlanningState = {
  styleGenreHint: null,
  crossfadeOverrideSec: null,
  djMode: "auto",
  forcedTransitionId: null,
  rerolledTransitionIds: [],
  stemAvailability: {},
  djVarietyBias: false,
  quantizeEnabled: true,
  recentTransitionIds: [],
};
const current = { track: track("a"), analysis: analysis() };
const next = { track: track("b"), analysis: analysis({ bpm: 126, camelotKey: "9A" }) };

const genrePlan = (style: TransitionStyle, over: Partial<GenreTransitionPlan> = {}): GenreTransitionPlan => ({ style, bars: 4, tools: [], keepSync: false, reason: "test", confidence: 0.8, fallbackPlan: null, genrePair: { a: "Pop", b: "Rock" }, ...over });
const pair = (plan: GenreTransitionPlan): PairGenrePlan => ({ fromId: "a", toId: "b", plan, mixability: 0.8, vetoes: [], decidedBy: "local", reason: "test", readout: "Pop to Rock" });

describe("handing a genre plan to the existing transition engine", () => {
  const args = planArgsFromState(state, {}, current, next);

  it("passes a beat-synced blend through UNCHANGED: the same arguments, plan and sync report as today", () => {
    for (const style of ["long-blend", "medium-blend", "short-blend", "bass-swap", "filter-sweep"] as const) {
      const adjusted = adjustPlanArgsForGenrePlan(args, genrePlan(style, { keepSync: true, bars: 24 }));
      expect(adjusted, style).toBe(args); // the very same object
      const before = planTransition(args);
      const after = planTransition(adjusted);
      expect(after, style).toEqual(before);
      expect(buildSyncReport({ current, next, plan: after }), style).toEqual(buildSyncReport({ current, next, plan: before }));
    }
  });

  it("leaves the arguments alone for bridges and a vocal swap (advisory for now)", () => {
    for (const style of ["instrumental-bridge", "scratch-bridge", "vocal-swap"] as const) expect(adjustPlanArgsForGenrePlan(args, genrePlan(style))).toBe(args);
  });

  it("pins the engine's echo-out for an echo-out or a silence-then-start", () => {
    for (const style of ["echo-out", "silence-then-start"] as const) {
      const adjusted = adjustPlanArgsForGenrePlan(args, genrePlan(style));
      expect(adjusted.forceTransitionId).toBe("echo-out");
      expect(planTransition(adjusted).transitionId).toBe("echo-out");
    }
  });

  it("turns a quick cut or a fade into a short phrase blend of the planned length (the engine never hard-cuts)", () => {
    for (const style of ["quick-cut", "fade"] as const) {
      const adjusted = adjustPlanArgsForGenrePlan(args, genrePlan(style, { bars: 2 }));
      expect(adjusted.forceTransitionId).toBe("phrase-blend");
      expect(adjusted.overrideSec).toBeCloseTo(barsToSec(2, 124));
      const planned = planTransition(adjusted);
      expect(planned.transitionId).toBe("phrase-blend");
      expect(planned.windowSec).toBeLessThanOrEqual(8);
    }
  });

  it("never shortens a window below two seconds, and keeps a crossfade length the person already set", () => {
    expect(adjustPlanArgsForGenrePlan(args, genrePlan("quick-cut", { bars: 0 })).overrideSec).toBeGreaterThanOrEqual(2);
    const set = planArgsFromState({ ...state, crossfadeOverrideSec: 10 }, {}, current, next);
    expect(adjustPlanArgsForGenrePlan(set, genrePlan("quick-cut")).overrideSec).toBe(10);
  });

  it("never overrides a transition the person pinned", () => {
    const pinned = planArgsFromState({ ...state, forcedTransitionId: "bass-swap" }, {}, current, next);
    expect(adjustPlanArgsForGenrePlan(pinned, genrePlan("echo-out"))).toBe(pinned);
    expect(adjustPlanArgsForGenrePlan(pinned, genrePlan("quick-cut"))).toBe(pinned);
  });
});

describe("planArgsFromState with the flag off (the default)", () => {
  it("ignores a genre plan entirely: the arguments are exactly what they were", () => {
    const without = planArgsFromState(state, {}, current, next);
    for (const style of ["echo-out", "quick-cut", "fade", "long-blend"] as const) {
      expect(planArgsFromState({ ...state, genrePlan: pair(genrePlan(style)) }, {}, current, next)).toEqual(without);
    }
  });
});

describe("which plan belongs to which pair", () => {
  it("matches only the exact upcoming pair", () => {
    const p = pair(genrePlan("echo-out"));
    expect(planMatchesPair(p, "a", "b")).toBe(true);
    expect(planMatchesPair(p, "a", "c")).toBe(false);
    expect(planMatchesPair(p, "x", "b")).toBe(false);
    expect(planMatchesPair(null, "a", "b")).toBe(false);
  });

  it("knows a beat-synced blend from the other styles", () => {
    expect(isBeatSyncedBlend({ style: "long-blend" })).toBe(true);
    expect(isBeatSyncedBlend({ style: "echo-out" })).toBe(false);
  });

  it("lets Song Sync's automatic morph run unless the genre plan performs the mix itself", () => {
    const echo = pair(genrePlan("echo-out"));
    expect(genrePlanSkipsSongSync(true, echo, "a", "b")).toBe(true);
    expect(genrePlanSkipsSongSync(true, pair(genrePlan("quick-cut")), "a", "b")).toBe(true);
    expect(genrePlanSkipsSongSync(true, pair(genrePlan("long-blend", { keepSync: true })), "a", "b")).toBe(false); // the morph runs as today
    expect(genrePlanSkipsSongSync(true, pair(genrePlan("scratch-bridge")), "a", "b")).toBe(false);
    expect(genrePlanSkipsSongSync(true, echo, "a", "other")).toBe(false); // a plan for a different pair
    expect(genrePlanSkipsSongSync(false, echo, "a", "b")).toBe(false); // flag off
    expect(genrePlanSkipsSongSync(true, null, "a", "b")).toBe(false);
  });
});

describe("a transition the genre layer chose is never described as the person's pick", () => {
  const args = planArgsFromState(state, {}, current, next);

  it("echo-out, quick-cut and fade carry the genre signal and read as chosen for the genres", () => {
    for (const style of ["echo-out", "quick-cut", "fade"] as const) {
      const adjusted = adjustPlanArgsForGenrePlan(args, genrePlan(style));
      expect(adjusted.chosenByGenre).toBe(true);
      const planned = planTransition(adjusted);
      expect(planned.rationale, style).not.toContain("your pick");
      expect(planned.shortWhy, style).not.toContain("your pick");
      expect(planned.rationale, style).toContain("genres");
    }
  });

  it("a transition the person pinned still says so, and beat-synced plans are not touched", () => {
    const pinned = planTransition(planArgsFromState({ ...state, forcedTransitionId: "bass-swap" }, {}, current, next));
    expect(pinned.rationale).toContain("your pick");
    expect(adjustPlanArgsForGenrePlan(args, genrePlan("long-blend", { keepSync: true })).chosenByGenre).toBeUndefined();
  });
});
