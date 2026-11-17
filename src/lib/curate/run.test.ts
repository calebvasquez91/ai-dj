import { describe, expect, it, vi } from "vitest";
import { runCuration, MAX_REQUEST_CHARS, type CurateDeps } from "@/lib/curate/run";
import { discoverSuggestions, similarArtists } from "@/lib/curate/discover";
import { parseRequestWithLlm, specToolSchema } from "@/lib/curate/llmSpec";
import { memoryCache } from "@/lib/genre/services";
import { genreLabels } from "@/lib/genres";
import type { GenreTag, Track } from "@/types/music";

const tag = (genre: string, confidence = 0.85, source: GenreTag["source"] = "musicbrainz"): GenreTag => ({ genre, source, confidence, updatedAt: 1 });
let n = 0;
const make = (over: Partial<Track> = {}): Track => {
  const id = over.id ?? `t${++n}`;
  return { id, title: id, artist: `Artist ${n % 5}`, durationSec: 230, addedAt: 0, source: "local", sourceUrl: `/api/tracks/${id}/audio`, ...over } as Track;
};
const rnb = (id: string, over: Partial<Track> = {}) => make({ id, genreTags: [tag("R&B"), tag("R&B", 0.8, "lastfm")], genreStatus: "auto", year: 1990 + (n % 10), ...over });

function deps(library: Track[], over: Partial<CurateDeps> = {}): CurateDeps & { calls: Record<string, number> } {
  const calls = { llm: 0, refine: 0, discover: 0 };
  return {
    calls,
    parseWithLlm: async () => (calls.llm++, null),
    loadLibrary: async () => ({ tracks: library, bpmOf: () => null }),
    loudnessOf: async () => new Map(),
    refine: async () => (calls.refine++, null),
    discover: async () => (calls.discover++, []),
    ...over,
  };
}

describe("runCuration", () => {
  const library = [
    ...Array.from({ length: 10 }, (_, i) => rnb(`rnb${i}`)),
    rnb("explicit", { explicit: "explicit" }),
    rnb("spooky", { tags: ["halloween"] }),
    make({ id: "rock", genreTags: [tag("Rock", 0.9), tag("Rock", 0.9, "lastfm")] }),
  ];

  it("turns '90s R&B for a workout, clean only' into a previewed playlist with an energy arc and no explicit or Halloween tracks", async () => {
    const d = deps(library);
    const r = await runCuration({ request: "90s R&B for a workout, clean only" }, d);
    expect(r.kind).toBe("preview");
    if (r.kind !== "preview") return;
    const ids = r.preview.tracks.map((t) => t.id);
    expect(ids.length).toBeGreaterThanOrEqual(8);
    expect(ids).not.toContain("explicit");
    expect(ids).not.toContain("spooky");
    expect(ids).not.toContain("rock");
    expect(r.preview.arc).toBe("build");
    expect(r.preview.spec.explicitPolicy).toBe("clean-only");
    expect(r.preview.tracks.every((t) => t.energy >= 0 && t.energy <= 1)).toBe(true);
    expect(r.usedModel).toEqual({ spec: false, refine: false });
    expect(d.calls.llm).toBe(1);
  });

  it("uses the model's spec when it is usable, checked against the taxonomy", async () => {
    const d = deps(library, { parseWithLlm: async () => ({ genres: ["Rap", "R&B"], subgenres: [], moods: [], eraRange: { from: 1990, to: 1999 }, targetLengthMinutes: 30 }) });
    const r = await runCuration({ request: "something" }, d);
    expect(r.kind === "preview" && r.usedModel.spec).toBe(true);
    expect(r.kind === "preview" && r.preview.spec.genres).toEqual(["Hip-Hop", "R&B"]);
  });

  it("falls back to the local reader when the model gives nothing usable, and asks only if that finds nothing too", async () => {
    const d = deps(library, { parseWithLlm: async () => ({ genres: [], subgenres: [], moods: [] }) });
    const ok = await runCuration({ request: "r&b from the 90s" }, d);
    expect(ok.kind).toBe("preview");
    const asks = await runCuration({ request: "something good" }, d);
    expect(asks.kind).toBe("clarification");
    const modelQuestion = await runCuration({ request: "something good" }, deps(library, { parseWithLlm: async () => ({ genres: [], subgenres: [], moods: [], clarification: "Which decade?" }) }));
    expect(modelQuestion).toMatchObject({ kind: "clarification", question: "Which decade?" });
  });

  it("answering a question adds to the request", async () => {
    const seen: string[] = [];
    const d = deps(library, { parseWithLlm: async (t) => (seen.push(t), null) });
    const r = await runCuration({ request: "something good", answer: "late 90s r&b" }, d);
    expect(seen[0]).toBe("something good. late 90s r&b");
    expect(r.kind).toBe("preview");
  });

  it("regenerates from a spec without reading the request again, and a seed changes the result", async () => {
    const d = deps(library);
    const first = await runCuration({ request: "90s R&B", seed: 0 }, d);
    if (first.kind !== "preview") throw new Error("no preview");
    const llmCallsBefore = d.calls.llm;
    const a = await runCuration({ spec: { ...first.preview.spec, targetLengthMinutes: 20 }, seed: 11 }, d);
    const b = await runCuration({ spec: { ...first.preview.spec, targetLengthMinutes: 20 }, seed: 99 }, d);
    expect(d.calls.llm).toBe(llmCallsBefore);
    if (a.kind !== "preview" || b.kind !== "preview") throw new Error("no preview");
    expect(a.preview.tracks.map((t) => t.id)).not.toEqual(b.preview.tracks.map((t) => t.id));
  });

  it("applies the model's order and description only when sound", async () => {
    let order: string[] = [];
    const d = deps(library, { refine: async (_t, preview) => ({ title: "Gym Throwbacks", description: "Sweaty slow jams.", order: (order = [...preview.tracks].reverse().map((t) => t.id)) }) });
    const r = await runCuration({ request: "90s R&B" }, d);
    expect(r.kind === "preview" && r.preview.title).toBe("Gym Throwbacks");
    expect(r.kind === "preview" && r.preview.tracks.map((t) => t.id)).toEqual(order);
    expect(r.kind === "preview" && r.usedModel.refine).toBe(true);

    const bad = deps(library, { refine: async () => ({ order: ["nope"], title: "<script>" }) });
    const rb = await runCuration({ request: "90s R&B" }, bad);
    expect(rb.kind === "preview" && rb.usedModel.refine).toBe(false);
    expect(rb.kind === "preview" && rb.preview.tracks.length).toBeGreaterThan(4);
    const boom = deps(library, { refine: async () => Promise.reject(new Error("down")) });
    expect((await runCuration({ request: "90s R&B" }, boom)).kind).toBe("preview");
  });

  it("with too few matches, shows a shortfall and Discover suggestions instead of padding", async () => {
    const small = [rnb("a1"), rnb("a2"), rnb("a3"), make({ id: "rock", genreTags: [tag("Rock", 0.9)] })];
    const d = deps(small, { discover: async (seeds) => [{ artist: "Someone New", because: `Similar to ${seeds[0]}`, match: 0.9 }] });
    const r = await runCuration({ request: "90s R&B", spec: undefined }, d);
    if (r.kind !== "preview") throw new Error("no preview");
    expect(r.preview.shortfall?.message).toMatch(/^Only 3 matching tracks/);
    expect(r.preview.tracks.map((t) => t.id).sort()).toEqual(["a1", "a2", "a3"]);
    expect(r.discover).toHaveLength(1);
    expect(r.discover[0].artist).toBe("Someone New");
  });

  it("does not ask for suggestions when the library covers the length", async () => {
    const d = deps(library);
    await runCuration({ request: "R&B, 10 minutes" }, d);
    expect(d.calls.discover).toBe(0);
  });

  it("rejects an empty or over-long request, and survives a failing Discover", async () => {
    expect(await runCuration({ request: "   " }, deps(library))).toMatchObject({ kind: "error", status: 400 });
    expect(await runCuration({ request: "x".repeat(MAX_REQUEST_CHARS + 1) }, deps(library))).toMatchObject({ kind: "error", status: 400 });
    const d = deps([rnb("a1")], { discover: async () => Promise.reject(new Error("x")) });
    const r = await runCuration({ request: "R&B for an hour" }, d);
    expect(r.kind === "preview" && r.discover).toEqual([]);
  });

  it("a Halloween request may use Halloween tracks, and nothing else may", async () => {
    const lib = [make({ id: "boo", tags: ["halloween"], genreTags: [{ genre: "Holiday", subgenre: "Halloween", source: "musicbrainz", confidence: 0.9, updatedAt: 1 }, { genre: "Holiday", subgenre: "Halloween", source: "lastfm", confidence: 0.9, updatedAt: 1 }] }), rnb("a")];
    const spooky = await runCuration({ request: "halloween music" }, deps(lib));
    expect(spooky.kind === "preview" && spooky.preview.tracks.map((t) => t.id)).toEqual(["boo"]);
    const normal = await runCuration({ request: "r&b" }, deps(lib));
    expect(normal.kind === "preview" && normal.preview.tracks.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("the model-backed spec reader", () => {
  const ok = (input: unknown) => new Response(JSON.stringify({ content: [{ type: "tool_use", name: "build_playlist_spec", input }] }));

  it("asks Haiku through a tool whose genre list is the taxonomy, with the taxonomy cached", async () => {
    let sent: Record<string, unknown> = {};
    const raw = await parseRequestWithLlm("90s R&B for a workout", {
      apiKey: () => "KEY",
      fetcher: async (_u, init) => ((sent = JSON.parse(String(init?.body))), ok({ genres: ["R&B"], subgenres: [], moods: ["workout"] })),
    });
    expect(raw).toEqual({ genres: ["R&B"], subgenres: [], moods: ["workout"] });
    expect(String(sent.model)).toMatch(/haiku/);
    expect(sent.tool_choice).toEqual({ type: "tool", name: "build_playlist_spec" });
    const schema = specToolSchema().input_schema.properties;
    expect(schema.genres.items.enum).toEqual([...genreLabels()]);
    expect(JSON.stringify(sent.system)).toContain("cache_control");
  });
  it("is null with no key, on an error, or with no tool answer", async () => {
    expect(await parseRequestWithLlm("x", { apiKey: () => undefined, fetcher: async () => ok({}) })).toBeNull();
    expect(await parseRequestWithLlm("x", { apiKey: () => "K", fetcher: async () => new Response("no", { status: 500 }) })).toBeNull();
    expect(await parseRequestWithLlm("x", { apiKey: () => "K", fetcher: async () => new Response(JSON.stringify({ content: [] })) })).toBeNull();
    expect(await parseRequestWithLlm("x", { apiKey: () => "K", fetcher: async () => Promise.reject(new Error("net")) })).toBeNull();
  });
});

describe("Discover suggestions", () => {
  const body = (names: string[]) => new Response(JSON.stringify({ similarartists: { artist: names.map((name, i) => ({ name, match: String(0.9 - i * 0.1) })) } }));
  const base = (fetcher: (url: string) => Response) => ({ fetcher: async (u: string) => fetcher(u), cache: memoryCache(), limiter: { acquire: async () => undefined }, userAgent: "QueDJ/2.0 ( x )", apiKey: () => "K" });

  it("suggests similar artists that are not already in the library, with why", async () => {
    const d = base(() => body(["Brandy", "Aaliyah", "Monica"]));
    const s = await discoverSuggestions(["Aaliyah-fan"], ["Aaliyah"], d);
    expect(s.map((x) => x.artist)).toEqual(["Brandy", "Monica"]);
    expect(s[0].because).toBe("Similar to Aaliyah-fan");
  });
  it("ranks an artist similar to several of the seeds first", async () => {
    const d = base((url) => (url.includes("artist=A") ? body(["Common", "OnlyA"]) : body(["OnlyB", "Common"])));
    const s = await discoverSuggestions(["A", "B"], [], d);
    expect(s[0].artist).toBe("Common");
    expect(s[0].because).toBe("Similar to A, B");
  });
  it("gives nothing without a key, and nothing on an error, and never adds a library track", async () => {
    expect(await similarArtists("A", { ...base(() => body(["X"])), apiKey: () => undefined })).toEqual([]);
    expect(await similarArtists("A", base(() => new Response("x", { status: 500 })))).toEqual([]);
    const s = await discoverSuggestions(["A"], [], base(() => body(["X"])));
    expect(Object.keys(s[0]).sort()).toEqual(["artist", "because", "match"]);
  });
  it("asks Last.fm once for the same artist", async () => {
    const fetcher = vi.fn(async () => body(["X"]));
    const d = { ...base(() => body([])), fetcher };
    await similarArtists("A", d);
    await similarArtists("A", d);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
