import { describe, expect, it } from "vitest";
import { RECENT_TRANSITIONS_KEPT, planArgsFromState, type PlanningState } from "./mix-engine";

const track = (id: string) => ({ track: { id } as never, analysis: {} as never });

const base: PlanningState = {
  styleGenreHint: "house",
  crossfadeOverrideSec: 12,
  djMode: "club",
  forcedTransitionId: "bass-swap",
  rerolledTransitionIds: ["echo-out"],
  stemAvailability: {},
  djVarietyBias: true,
  quantizeEnabled: false,
  recentTransitionIds: ["long-blend"],
  categoryWeights: { cut: 2 },
};

describe("planArgsFromState", () => {
  it("carries every planning input through under the engine's argument names", () => {
    const args = planArgsFromState(base, track("a"), track("b"), { currentElapsedSec: 41.5 });
    expect(args).toMatchObject({
      genreHint: "house",
      overrideSec: 12,
      djMode: "club",
      currentElapsedSec: 41.5,
      recentTransitionIds: ["long-blend"],
      forceTransitionId: "bass-swap",
      varietyBias: true,
      categoryWeights: { cut: 2 },
      quantize: false,
    });
    expect(args.current.track.id).toBe("a");
    expect(args.next.track.id).toBe("b");
  });

  it("keeps vocal-layering out of the running when the incoming track has no vocal stem", () => {
    const args = planArgsFromState(base, track("a"), track("b"));
    expect(args.vocalStemReady).toBe(false);
    expect(args.excludeTransitionIds).toEqual(["echo-out", "vocal-layering"]);
  });

  it("allows vocal-layering, with its bonus, once the incoming vocal stem is ready", () => {
    const args = planArgsFromState({ ...base, stemAvailability: { b: "https://stem/vocals.wav" } }, track("a"), track("b"));
    expect(args.vocalStemReady).toBe(true);
    expect(args.excludeTransitionIds).toEqual(["echo-out"]);
  });

  it("only looks at the INCOMING track's stem, not the outgoing one's", () => {
    const args = planArgsFromState({ ...base, stemAvailability: { a: "https://stem/vocals.wav" } }, track("a"), track("b"));
    expect(args.vocalStemReady).toBe(false);
  });

  it("ignoreOverrides drops the pin and the re-rolls but keeps the stem rule", () => {
    const args = planArgsFromState(base, track("a"), track("b"), { ignoreOverrides: true });
    expect(args.forceTransitionId).toBeNull();
    expect(args.excludeTransitionIds).toEqual(["vocal-layering"]);
  });

  it("defaults the playhead to unknown", () => {
    expect(planArgsFromState(base, track("a"), track("b")).currentElapsedSec).toBeNull();
  });

  it("remembers a few recent transitions, not an unbounded history", () => {
    expect(RECENT_TRANSITIONS_KEPT).toBe(3);
  });
});
