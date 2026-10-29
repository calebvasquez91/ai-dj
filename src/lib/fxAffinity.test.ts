import { describe, expect, it } from "vitest";
import { HALLOWEEN_AFFINITY, getEligibleFX, hasHalloweenAffinity, withHalloweenAffinity } from "./fxAffinity";

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

describe("getEligibleFX", () => {
  const make = (id: string, tags: string[], playlistAffinity: string[]) =>
    ({ id, name: id, tags, playlistAffinity }) as unknown as import("@/types/music").FxSound;
  const library = [
    make("by-tag", ["Halloween"], []),
    make("by-affinity-spooky", [], ["Spooky"]),
    make("by-affinity-halloween", [], ["halloween"]),
    make("plain", ["riser"], ["club"]),
    make("untagged", [], []),
  ];

  it("in Spooky Music offers only the Halloween sounds", () => {
    expect(getEligibleFX(library, true).map((fx) => fx.id)).toEqual(["by-tag", "by-affinity-spooky", "by-affinity-halloween"]);
  });

  it("anywhere else offers everything except the Halloween sounds", () => {
    expect(getEligibleFX(library, false).map((fx) => fx.id)).toEqual(["plain", "untagged"]);
  });

  it("never offers a sound in both modes", () => {
    const spooky = getEligibleFX(library, true).map((fx) => fx.id);
    const other = getEligibleFX(library, false).map((fx) => fx.id);
    expect(spooky.filter((id) => other.includes(id))).toEqual([]);
    expect(spooky.length + other.length).toBe(library.length);
  });

  it("handles an empty library", () => {
    expect(getEligibleFX([], true)).toEqual([]);
    expect(getEligibleFX([], false)).toEqual([]);
  });
});
