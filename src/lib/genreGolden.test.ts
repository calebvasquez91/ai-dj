// The sync golden test, with GENRE_TRANSITIONS_ENABLED switched ON: for any pair whose genre plan is a beat-synced blend, the arguments the transition
// engine receives, the plan it makes and the SyncReport are identical to the ones it makes with no genre plan at all (today's behaviour).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/featureFlags", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/featureFlags")>()), GENRE_TRANSITIONS_ENABLED: true }));

import { fallbackAnalysis, type TrackAnalysis } from "./audio-analysis-core";
import type { PairGenrePlan } from "./genrePlanApply";
import { planArgsFromState, planTransition, type PlanningState } from "./mix-engine";
import { buildSyncReport } from "./syncEngine";
import type { GenreTransitionPlan } from "./transitionPlanner";
import type { TransitionStyle } from "./genreTransitions";

const analysis = (over: Partial<TrackAnalysis> = {}): TrackAnalysis => ({ ...fallbackAnalysis(), fallback: false, bpm: 124, bpmConfidence: 0.9, key: "A minor", camelotKey: "8A", keyConfidence: 0.8, energyOnsetSec: 8, waveformPeaks: Array.from({ length: 200 }, (_, i) => 0.3 + 0.4 * Math.abs(Math.sin(i / 9))), ...over });
const track = (id: string) => ({ id, title: id, artist: "x", durationSec: 200, source: "local" as const, sourceUrl: `blob:${id}` }) as never;
const state: PlanningState = { styleGenreHint: null, crossfadeOverrideSec: null, djMode: "auto", forcedTransitionId: null, rerolledTransitionIds: [], stemAvailability: {}, djVarietyBias: false, quantizeEnabled: true, recentTransitionIds: [] };
const plan = (style: TransitionStyle, keepSync: boolean): PairGenrePlan => ({ fromId: "a", toId: "b", mixability: 0.9, vetoes: [], decidedBy: "local", reason: "t", readout: "t", plan: { style, bars: 16, tools: [], keepSync, reason: "t", confidence: 0.9, fallbackPlan: null, genrePair: { a: "Electronic", b: "Electronic" } } satisfies GenreTransitionPlan });

const PAIRS: [string, TrackAnalysis, TrackAnalysis][] = [
  ["same tempo, same key", analysis(), analysis()],
  ["close tempo, neighbouring key", analysis(), analysis({ bpm: 126, camelotKey: "9A" })],
  ["half-time", analysis({ bpm: 124 }), analysis({ bpm: 62, camelotKey: "8B" })],
  ["wide gap, clashing key", analysis({ bpm: 100 }), analysis({ bpm: 128, camelotKey: "3B" })],
  ["unsure tempo", analysis({ bpmConfidence: 0.1 }), analysis()],
];

describe("sync golden test, GENRE_TRANSITIONS_ENABLED on", () => {
  for (const [label, a, b] of PAIRS) {
    for (const style of ["long-blend", "medium-blend", "short-blend", "bass-swap", "filter-sweep"] as const) {
      it(`${label}: a ${style} plan gives the same engine arguments, transition plan and SyncReport as no genre plan`, () => {
        const current = { track: track("a"), analysis: a };
        const next = { track: track("b"), analysis: b };
        const without = planArgsFromState(state, {}, current, next, { currentElapsedSec: 60 });
        const withPlan = planArgsFromState({ ...state, genrePlan: plan(style, true) }, {}, current, next, { currentElapsedSec: 60 });
        expect(withPlan).toEqual(without);
        const planBefore = planTransition(without);
        const planAfter = planTransition(withPlan);
        expect(planAfter).toEqual(planBefore);
        expect(buildSyncReport({ current, next, plan: planAfter })).toEqual(buildSyncReport({ current, next, plan: planBefore }));
      });
    }
  }

  it("really is on: a non-sync plan for the same pair DOES change the arguments (so the equality above is not vacuous)", () => {
    const current = { track: track("a"), analysis: analysis() };
    const next = { track: track("b"), analysis: analysis() };
    const echo = planArgsFromState({ ...state, genrePlan: plan("echo-out", false) }, {}, current, next);
    expect(echo.forceTransitionId).toBe("echo-out");
    expect(planArgsFromState(state, {}, current, next).forceTransitionId).toBeNull();
  });

  it("a plan made for another pair changes nothing", () => {
    const current = { track: track("a"), analysis: analysis() };
    const next = { track: track("other"), analysis: analysis() };
    expect(planArgsFromState({ ...state, genrePlan: plan("echo-out", false) }, {}, current, next)).toEqual(planArgsFromState(state, {}, current, next));
  });
});
