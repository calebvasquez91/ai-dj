import { describe, expect, it } from "vitest";
import { PITCH_CLASSES, camelotCompatibility, camelotForKey, camelotRank } from "./camelot";
import { camelotCompatibility as fromMixEngine } from "./mix-engine";

describe("camelotForKey", () => {
  it("maps keys to the wheel", () => {
    expect(camelotForKey("A minor")).toBe("8A");
    expect(camelotForKey("C major")).toBe("8B");
    expect(camelotForKey("F# minor")).toBe("11A");
    expect(camelotForKey("B major")).toBe("1B");
    expect(camelotForKey("nonsense")).toBeNull();
    expect(camelotForKey(null)).toBeNull();
  });

  it("gives every one of the 24 keys its own code", () => {
    const codes = new Set(PITCH_CLASSES.flatMap((p) => [camelotForKey(`${p} major`), camelotForKey(`${p} minor`)]));
    expect(codes.size).toBe(24);
  });
});

describe("camelotRank", () => {
  it("runs 1A, 1B, 2A ... 12B", () => {
    const order = ["1A", "1B", "2A", "2B", "9B", "10A", "12B"].map((c) => camelotRank(c) as number);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("is null for anything that is not a code", () => {
    for (const v of [null, undefined, "", "13A", "0B", "8C", "A minor"]) expect(camelotRank(v)).toBeNull();
    expect(camelotRank(" 8a ")).toBe(camelotRank("8A"));
  });
});

describe("camelotCompatibility", () => {
  it("2 for the same key, 1 for the relative or an adjacent key on the wheel (wrapping 12 to 1), 0 for a clash or an unknown", () => {
    expect(camelotCompatibility("8A", "8A")).toBe(2);
    expect(camelotCompatibility("8A", "8B")).toBe(1);
    expect(camelotCompatibility("8A", "9A")).toBe(1);
    expect(camelotCompatibility("12A", "1A")).toBe(1);
    expect(camelotCompatibility("8A", "3B")).toBe(0);
    expect(camelotCompatibility("8A", "10A")).toBe(0);
    expect(camelotCompatibility(null, "8A")).toBe(0);
    expect(camelotCompatibility("8A", "nonsense")).toBe(0);
  });

  it("is still exported from the mixing engine, as the same function, for the code that imports it from there", () => {
    expect(fromMixEngine).toBe(camelotCompatibility);
  });
});
