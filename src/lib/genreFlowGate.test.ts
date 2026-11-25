// The genre-flow cost in playlist ordering follows the person's own switch, not only the build flag: with GENRE_TRANSITIONS_ENABLED on, a device that has genre-aware
// transitions off still gets the order it always got.
import { beforeEach, describe, expect, it, vi } from "vitest";

const weights: number[] = [];

vi.mock("@/lib/featureFlags", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/featureFlags")>()), GENRE_TRANSITIONS_ENABLED: true }));
vi.mock("@/lib/curate/energyArc", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/curate/energyArc")>();
  return { ...real, orderByEnergyArc: (items: Parameters<typeof real.orderByEnergyArc>[0], arc: Parameters<typeof real.orderByEnergyArc>[1], seed?: number, genreWeight?: number) => { weights.push(genreWeight ?? 0); return real.orderByEnergyArc(items, arc, seed, genreWeight); } };
});

import { runCuration } from "./curate/run";
import { finishCuration, selectForCuration } from "./curate/curate";
import { GENRE_FLOW_WEIGHT } from "./genreTransitions";
import { nextRadioBatch, type RadioFacts } from "./radio";
import type { GenreTag, Track } from "@/types/music";

beforeEach(() => { weights.length = 0; });

const tag = (genre: string): GenreTag => ({ genre, source: "musicbrainz", confidence: 0.9, updatedAt: 1 });
let seq = 0;
const track = (over: Partial<Track> & { facts?: RadioFacts } = {}): Track & { facts: RadioFacts } => {
  const id = `g${++seq}`;
  const { facts, ...rest } = over;
  return { id, title: id, artist: `artist ${seq % 15}`, durationSec: 200, addedAt: 0, source: "local", sourceUrl: `x/${id}`, genre: "Hip-Hop", subgenres: ["Trap"], moods: ["late-night"], facts: facts ?? { bpm: 140, camelot: "8A", energy: 0.7 }, ...rest } as Track & { facts: RadioFacts };
};

describe("radio ordering", () => {
  const seed = track({ id: "seed" });
  const lib = [seed, ...Array.from({ length: 40 }, () => track())];
  const run = (genreFlow?: boolean) => { weights.length = 0; nextRadioBatch(seed, lib, { factsOf: (t) => (t as Track & { facts: RadioFacts }).facts, ...(genreFlow === undefined ? {} : { genreFlow }) }); return [...weights]; };

  it("clusters by genre only for a device that has the feature switched on", () => {
    expect(run(true)).toEqual([GENRE_FLOW_WEIGHT]);
    expect(run(false)).toEqual([0]);
    expect(run()).toEqual([0]);
  });
});

describe("curation ordering", () => {
  const lib = Array.from({ length: 14 }, () => track({ genreTags: [tag("R&B")], genreStatus: "auto", year: 1996 } as Partial<Track>));
  const deps = { parseWithLlm: async () => null, loadLibrary: async () => ({ tracks: lib as Track[], bpmOf: () => 100 }), loudnessOf: async () => new Map<string, number | null>(), refine: async () => null, discover: async () => [] };

  it("passes the weight through finishCuration only when it is given", () => {
    const inputs = { spec: { genres: ["R&B"], subgenres: [], moods: [], targetLengthMinutes: 40 }, library: lib as Track[], bpmOf: () => 100 };
    finishCuration(inputs, selectForCuration(inputs));
    finishCuration({ ...inputs, genreFlowWeight: GENRE_FLOW_WEIGHT }, selectForCuration(inputs));
    expect(weights).toEqual([0, GENRE_FLOW_WEIGHT]);
  });

  it("uses the genre cost only when the request says this device has the feature on", async () => {
    await runCuration({ request: "90s R&B", genreFlow: true }, deps);
    await runCuration({ request: "90s R&B", genreFlow: false }, deps);
    await runCuration({ request: "90s R&B" }, deps);
    await runCuration({ request: "90s R&B", genreFlow: "yes" }, deps);
    expect(weights).toEqual([GENRE_FLOW_WEIGHT, 0, 0, 0]);
  });
});
