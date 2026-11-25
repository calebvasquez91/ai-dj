import { describe, expect, it } from "vitest";
import { orderByEnergyArc, type OrderInput } from "./curate/energyArc";
import { GENRE_FLOW_WEIGHT, genreFlowDistance } from "./genreTransitions";

describe("genreFlowDistance", () => {
  it("is 0 for the same genre and when either genre is unknown", () => {
    expect(genreFlowDistance("Pop", "Pop")).toBe(0);
    expect(genreFlowDistance(undefined, "Pop")).toBe(0);
    expect(genreFlowDistance("Pop", null)).toBe(0);
    expect(genreFlowDistance("Pop", "Made Up")).toBe(0);
  });

  it("is symmetric, within 0..1, and larger for genres that mix very differently", () => {
    const d = genreFlowDistance("Electronic", "Jazz");
    expect(d).toBeCloseTo(genreFlowDistance("Jazz", "Electronic"));
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(1);
    expect(d).toBeGreaterThan(genreFlowDistance("Pop", "Hip-Hop"));
  });
});

describe("orderByEnergyArc with a genre weight", () => {
  // Eight songs at the same energy, alternating genres: only the genre term can tell their order.
  const items: OrderInput[] = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, energy: 0.6, bpm: 120, genre: i % 2 === 0 ? "Electronic" : "Jazz" }));
  const jumps = (order: OrderInput[]) => order.slice(1).filter((o, i) => o.genre !== order[i].genre).length;

  it("clusters same-genre songs when the energy scores are equal", () => {
    const flat = orderByEnergyArc(items, "steady");
    const clustered = orderByEnergyArc(items, "steady", 0, GENRE_FLOW_WEIGHT);
    expect(jumps(clustered)).toBeLessThan(jumps(flat));
    expect(jumps(clustered)).toBe(1);
  });

  it("changes nothing with no weight (the default): the order is exactly what it was", () => {
    expect(orderByEnergyArc(items, "build", 0, 0).map((o) => o.id)).toEqual(orderByEnergyArc(items, "build").map((o) => o.id));
  });

  it("does not trade away the energy arc for a tidy genre order", () => {
    const spread: OrderInput[] = [
      { id: "lo-a", energy: 0.1, bpm: 120, genre: "Jazz" },
      { id: "hi-a", energy: 0.95, bpm: 120, genre: "Electronic" },
      { id: "lo-b", energy: 0.15, bpm: 120, genre: "Electronic" },
      { id: "hi-b", energy: 0.9, bpm: 120, genre: "Jazz" },
    ];
    const energies = orderByEnergyArc(spread, "build", 0, GENRE_FLOW_WEIGHT).map((o) => o.energy);
    // a build still rises
    expect(energies[energies.length - 1]).toBeGreaterThan(energies[0]);
  });
});
