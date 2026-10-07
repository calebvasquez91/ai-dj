import { describe, expect, it } from "vitest";
import { resampleBuckets } from "./resample";

describe("resampleBuckets", () => {
  it("takes the max of each slice (waveform peaks)", () => {
    expect(resampleBuckets([1, 5, 2, 4, 3, 0], 3, "max")).toEqual([5, 4, 3]);
  });

  it("takes the mean of each slice (energy levels)", () => {
    expect(resampleBuckets([1, 3, 2, 4, 0, 6], 3, "mean")).toEqual([2, 3, 3]);
  });

  it("returns a copy of the input when it already has no more values than buckets", () => {
    const input = [0.2, 0.4];
    const out = resampleBuckets(input, 5, "max");
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it("covers every source value even when the slices are uneven", () => {
    const out = resampleBuckets([1, 1, 1, 1, 1, 1, 1], 3, "mean"); // 7 values into 3 buckets
    expect(out).toEqual([1, 1, 1]);
    expect(resampleBuckets([0, 0, 0, 0, 0, 0, 9], 3, "max")[2]).toBe(9); // the last value isn't dropped
  });

  it("counts non-finite values as 0 and handles an empty target", () => {
    expect(resampleBuckets([NaN, 4, Infinity, 2], 2, "max")).toEqual([4, 2]); // NaN and Infinity count as 0, not as the max
    expect(resampleBuckets([NaN, NaN, Infinity, Infinity], 2, "mean")).toEqual([0, 0]);
    expect(resampleBuckets([1, 2, 3], 0, "max")).toEqual([]);
  });
});
