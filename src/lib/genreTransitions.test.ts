import { describe, expect, it } from "vitest";
import { GENRES } from "./genres";
import { DEFAULT_GENRE_RULE, GENRE_TRANSITIONS, TRANSITION_STYLES, TRANSITION_TOOLS, genreRule } from "./genreTransitions";

describe("the genre transition table", () => {
  it("has an entry for every top-level genre in the taxonomy, and no entry for a genre that is not in it", () => {
    const labels = GENRES.map((g) => g.label);
    expect(labels.filter((l) => !(l in GENRE_TRANSITIONS))).toEqual([]);
    expect(Object.keys(GENRE_TRANSITIONS).filter((k) => !labels.includes(k))).toEqual([]);
  });

  it("only uses known styles and tools, with a sane bar range, tolerance and key importance", () => {
    for (const [genre, r] of [...Object.entries(GENRE_TRANSITIONS), ["default", DEFAULT_GENRE_RULE] as const]) {
      expect(r.preferredStyles.length, genre).toBeGreaterThan(0);
      for (const s of r.preferredStyles) expect(TRANSITION_STYLES, `${genre}: ${s}`).toContain(s);
      for (const t of r.allowedTools) expect(TRANSITION_TOOLS, `${genre}: ${t}`).toContain(t);
      expect(r.blendBarsRange[0], genre).toBeGreaterThanOrEqual(1);
      expect(r.blendBarsRange[1], genre).toBeGreaterThanOrEqual(r.blendBarsRange[0]);
      expect(r.bpmTolerancePct, genre).toBeGreaterThanOrEqual(0);
      expect(r.keyMatchImportance, genre).toBeGreaterThanOrEqual(0);
      expect(r.keyMatchImportance, genre).toBeLessThanOrEqual(1);
    }
  });

  it("never offers a beat-synced blend for a genre with no beat to sync", () => {
    const blends = ["long-blend", "medium-blend", "short-blend", "bass-swap", "filter-sweep"];
    for (const [genre, r] of Object.entries(GENRE_TRANSITIONS)) {
      if (r.beatSync === "none") for (const s of r.preferredStyles) expect(blends, `${genre}: ${s}`).not.toContain(s);
    }
  });

  it("falls back to the safe default for a genre it does not know", () => {
    expect(genreRule("Made Up")).toBe(DEFAULT_GENRE_RULE);
    expect(genreRule(undefined)).toBe(DEFAULT_GENRE_RULE);
    expect(genreRule("Hip-Hop")).toBe(GENRE_TRANSITIONS["Hip-Hop"]);
  });
});
