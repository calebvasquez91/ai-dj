import { describe, expect, it } from "vitest";
import { adviseStyle, resolveGenreFamily } from "./dj-inspiration";

describe("resolveGenreFamily", () => {
  it("matches techno directly", () => {
    expect(resolveGenreFamily("techno").id).toBe("techno");
  });

  it("matches a subgenre to its parent family", () => {
    expect(resolveGenreFamily("minimal techno").id).toBe("techno");
  });

  it("matches mood keywords", () => {
    expect(resolveGenreFamily("chill study session").id).toBe("downtempo");
  });

  it("falls back to house for unrecognized input", () => {
    expect(resolveGenreFamily("xyzzy nonsense").id).toBe("house");
  });

  it("falls back to house for empty input", () => {
    expect(resolveGenreFamily("").id).toBe("house");
  });
});

describe("adviseStyle", () => {
  it("recommends harmonic mixing and techno DJs for a techno-inspired set", () => {
    const advice = adviseStyle("give me a techno-inspired set");
    expect(advice.genre.id).toBe("techno");
    expect(advice.technique.id).toBe("harmonic-mixing");
    expect(advice.djs.length).toBeGreaterThan(0);
    expect(advice.djs.every((dj) => dj.genres.includes("techno"))).toBe(true);
  });

  it("recommends turntablism and hip-hop DJs for a hip-hop set", () => {
    const advice = adviseStyle("hip-hop block party");
    expect(advice.genre.id).toBe("hip-hop");
    expect(advice.technique.id).toBe("turntablism");
    expect(advice.djs.some((dj) => dj.name === "Grandmaster Flash" || dj.name === "Q-Bert")).toBe(true);
  });

  it("recommends harmonic mixing and house DJs for a house set", () => {
    const advice = adviseStyle("deep house");
    expect(advice.genre.id).toBe("house");
    expect(advice.technique.id).toBe("harmonic-mixing");
    expect(advice.djs.length).toBeGreaterThan(0);
  });

  it("returns a non-empty rationale string", () => {
    const advice = adviseStyle("techno");
    expect(advice.rationale.length).toBeGreaterThan(0);
  });

  it("respects the requested DJ count", () => {
    const advice = adviseStyle("house", 2);
    expect(advice.djs.length).toBeLessThanOrEqual(2);
  });
});
