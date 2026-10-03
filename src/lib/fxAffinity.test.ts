import { describe, expect, it } from "vitest";
import { HALLOWEEN_AFFINITY, hasHalloweenAffinity, withHalloweenAffinity } from "./fxAffinity";

describe("hasHalloweenAffinity", () => {
  it("is true for either Halloween tag, any case", () => {
    expect(hasHalloweenAffinity(["spooky"])).toBe(true);
    expect(hasHalloweenAffinity(["Halloween"])).toBe(true);
  });

  it("is false for no tags or unrelated tags", () => {
    expect(hasHalloweenAffinity([])).toBe(false);
    expect(hasHalloweenAffinity(["christmas"])).toBe(false);
  });
});

describe("withHalloweenAffinity", () => {
  it("adds both tags to an empty list", () => {
    expect(withHalloweenAffinity([])).toEqual(HALLOWEEN_AFFINITY);
  });

  it("keeps existing tags and only adds the missing one", () => {
    expect(withHalloweenAffinity(["chill", "Spooky"])).toEqual(["chill", "Spooky", "halloween"]);
  });

  it("leaves an already-tagged list unchanged", () => {
    expect(withHalloweenAffinity(["spooky", "halloween"])).toEqual(["spooky", "halloween"]);
  });

  it("does not mutate the input", () => {
    const input = ["chill"];
    withHalloweenAffinity(input);
    expect(input).toEqual(["chill"]);
  });
});
