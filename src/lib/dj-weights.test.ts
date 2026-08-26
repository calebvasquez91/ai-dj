import { beforeEach, describe, expect, it } from "vitest";
import { useDjWeights, LEARNING_NUDGE_UP, LEARNING_NUDGE_DOWN } from "./dj-weights";

describe("useDjWeights", () => {
  beforeEach(() => {
    useDjWeights.getState().reset();
  });

  it("starts with no weights", () => {
    expect(useDjWeights.getState().categoryWeights).toEqual({});
  });

  it("nudges a category's weight by the given delta", () => {
    useDjWeights.getState().nudge("riser", LEARNING_NUDGE_UP);
    expect(useDjWeights.getState().categoryWeights.riser).toBe(LEARNING_NUDGE_UP);
  });

  it("accumulates repeated nudges to the same category", () => {
    useDjWeights.getState().nudge("cut", LEARNING_NUDGE_DOWN);
    useDjWeights.getState().nudge("cut", LEARNING_NUDGE_DOWN);
    expect(useDjWeights.getState().categoryWeights.cut).toBe(LEARNING_NUDGE_DOWN * 2);
  });

  it("tracks separate categories independently", () => {
    useDjWeights.getState().nudge("riser", LEARNING_NUDGE_UP);
    useDjWeights.getState().nudge("cut", LEARNING_NUDGE_DOWN);
    expect(useDjWeights.getState().categoryWeights).toEqual({
      riser: LEARNING_NUDGE_UP,
      cut: LEARNING_NUDGE_DOWN,
    });
  });

  it("clamps a weight from running away in either direction", () => {
    for (let i = 0; i < 50; i++) useDjWeights.getState().nudge("blend", 5);
    expect(useDjWeights.getState().categoryWeights.blend).toBe(15);

    for (let i = 0; i < 50; i++) useDjWeights.getState().nudge("blend", -5);
    expect(useDjWeights.getState().categoryWeights.blend).toBe(-15);
  });

  it("reset() clears all learned weights", () => {
    useDjWeights.getState().nudge("riser", LEARNING_NUDGE_UP);
    useDjWeights.getState().reset();
    expect(useDjWeights.getState().categoryWeights).toEqual({});
  });
});
