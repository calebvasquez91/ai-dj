import { describe, expect, it } from "vitest";
import { coverGradient, coverInitial, hashSeed } from "./coverGradient";

describe("hashSeed", () => {
  it("is stable and never negative", () => {
    expect(hashSeed("Dance Floor")).toBe(hashSeed("Dance Floor"));
    expect(hashSeed("")).toBeGreaterThanOrEqual(0);
    expect(hashSeed("\u00e9\u00e8\u2603")).toBeGreaterThanOrEqual(0);
  });

  it("tells different strings apart", () => {
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
  });
});

describe("coverGradient", () => {
  it("is a CSS linear gradient", () => {
    expect(coverGradient("Dance Floor")).toMatch(/^linear-gradient\(135deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
  });

  it("gives the same cover to the same title, however it is cased or padded", () => {
    expect(coverGradient("  Dance FLOOR ")).toBe(coverGradient("dance floor"));
  });

  it("does not give every title the same cover", () => {
    const covers = new Set(["Dance Floor", "Daughter", "Midnight City", "Move Ya Body", "Caf\u00e9 del Mar", "Zebra", "Alpha", "Omega"].map(coverGradient));
    expect(covers.size).toBeGreaterThan(2);
  });

  it("copes with an empty seed", () => {
    expect(coverGradient("")).toMatch(/^linear-gradient/);
  });
});

describe("coverInitial", () => {
  it("is the first letter or digit, uppercased", () => {
    expect(coverInitial("dance floor")).toBe("D");
    expect(coverInitial("  \u00e9clair")).toBe("\u00c9");
    expect(coverInitial("99 Problems")).toBe("9");
  });

  it("skips punctuation and falls back to a music note", () => {
    expect(coverInitial("...Baby One More Time")).toBe("B");
    expect(coverInitial("")).toBe("\u266A");
    expect(coverInitial("!!!")).toBe("\u266A");
  });
});
