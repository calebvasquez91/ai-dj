import { describe, expect, it } from "vitest";
import { estimateStructuralCues } from "./structural-estimate";

describe("estimateStructuralCues", () => {
  it("estimates a drop 30% into the track and a breakdown 65% in", () => {
    expect(estimateStructuralCues(200)).toEqual({
      estimatedDropAtSec: 60,
      estimatedBreakdownAtSec: 130,
    });
  });

  it("scales with duration", () => {
    const short = estimateStructuralCues(100);
    const long = estimateStructuralCues(300);
    expect(long.estimatedDropAtSec).toBeCloseTo(short.estimatedDropAtSec * 3, 5);
    expect(long.estimatedBreakdownAtSec).toBeCloseTo(short.estimatedBreakdownAtSec * 3, 5);
  });
});
