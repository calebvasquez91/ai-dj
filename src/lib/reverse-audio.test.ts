import { describe, expect, it } from "vitest";
import { reverseSamples } from "./reverse-audio";

describe("reverseSamples", () => {
  it("reverses the sample order", () => {
    // Whole numbers, not fractions — Float32Array's reduced precision means
    // a value like 0.1 doesn't round-trip exactly, which isn't what this
    // test is about.
    const input = new Float32Array([1, 2, 3, 4]);
    expect(Array.from(reverseSamples(input))).toEqual([4, 3, 2, 1]);
  });

  it("returns a new array rather than mutating the input", () => {
    const input = new Float32Array([1, 2, 3]);
    const reversed = reverseSamples(input);
    expect(Array.from(input)).toEqual([1, 2, 3]);
    expect(reversed).not.toBe(input);
  });

  it("handles a single-sample array", () => {
    expect(Array.from(reverseSamples(new Float32Array([0.5])))).toEqual([0.5]);
  });

  it("handles an empty array", () => {
    expect(Array.from(reverseSamples(new Float32Array([])))).toEqual([]);
  });

  it("reversing twice restores the original order", () => {
    const input = new Float32Array([5, -2, 0, 3.5, -8]);
    expect(Array.from(reverseSamples(reverseSamples(input)))).toEqual(Array.from(input));
  });
});
