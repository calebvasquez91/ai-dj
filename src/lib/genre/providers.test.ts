import { describe, expect, it, vi } from "vitest";
import { cleanTitle, isUnknownArtist, primaryArtist, sameName } from "@/lib/genre/names";
import { createRateLimiter, memoryCache, memoryRateStore, PROVIDER_MIN_INTERVAL_MS, RATE_WAIT_LIMIT_MS } from "@/lib/genre/services";
import { cachedJsonGet, HttpError } from "@/lib/genre/http";
import { FILE_TAG_CLEAN_CONFIDENCE, createFileTagProvider, genreTagsFromFileTags } from "@/lib/genre/fileTags";
import { artistConfidence, createMusicBrainzProvider, recordingConfidence } from "@/lib/genre/musicBrainz";
import { createLastFmProvider, trackTagConfidence } from "@/lib/genre/lastFm";
import { MIN_FINGERPRINT_SCORE, createFingerprintResolver } from "@/lib/genre/fingerprint";
import {
  CLASSIFIER_GENRE_CAP,
  CLASSIFIER_SUBGENRE_CAP,
  createAudioClassifierProvider,
  isClassifierEnabled,
  nodesFromModelLabel,
} from "@/lib/genre/audioClassifier";
import { GENRE_LLM_MODEL, LLM_CONFIDENCE_CAP, createLlmReconciler, taxonomyPrompt, validateReconcile } from "@/lib/genre/llmReconciler";
import { genreLabels } from "@/lib/genres";
import { normalizeMood } from "@/lib/moodTags";
import type { Fetcher, ProviderInput } from "@/lib/genre/types";

const input: ProviderInput = { trackId: "t1", title: "Tiny Dancer", artist: "Elton John", durationSec: 377, source: "local", storageKey: "abc", mimeType: "audio/mpeg" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A fetcher that answers by URL and records every call. */
function router(handle: (url: string, init?: RequestInit) => Response | undefined) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, init });
    return handle(url, init) ?? json({}, 404);
  };
  return { fetcher, calls };
}
const noLimit = { acquire: async () => undefined };
const UA = "QueDJ/2.0 ( https://example.test )";

describe("names", () => {
  it("takes the release noise off a title and keeps the title itself", () => {
    expect(cleanTitle("Tiny Dancer (feat. Someone)")).toBe("Tiny Dancer");
    expect(cleanTitle("Song [Explicit]")).toBe("Song");
    expect(cleanTitle("Song - 2011 Remaster")).toBe("Song");
    expect(cleanTitle("Song - Remastered 2011")).toBe("Song");
    expect(cleanTitle("Song (Radio Edit)")).toBe("Song");
    expect(cleanTitle("Song ft. Rihanna")).toBe("Song");
    expect(cleanTitle("Song (Live at Wembley)")).toBe("Song (Live at Wembley)");
    expect(cleanTitle("(Remastered)")).toBe("(Remastered)");
  });
  it("finds the main artist of a collaboration", () => {
    expect(primaryArtist("Drake feat. Rihanna")).toBe("Drake");
    expect(primaryArtist("Beyoncé, Jay-Z")).toBe("Beyoncé");
    expect(primaryArtist("Simon & Garfunkel")).toBe("Simon");
    expect(primaryArtist("Elton John")).toBe("Elton John");
  });
  it("knows an artist field that says nothing, and compares names loosely", () => {
    for (const a of ["", "Unknown Artist", "unknown", "Various Artists"]) expect(isUnknownArtist(a)).toBe(true);
    expect(isUnknownArtist("Elton John")).toBe(false);
    expect(sameName("Beyoncé", "BEYONCE")).toBe(true);
    expect(sameName("Rock & Roll", "rock and roll")).toBe(true);
    expect(sameName("", "")).toBe(false);
  });
});

describe("the rate limiter", () => {
  it("spaces requests to a provider by its interval and queues callers instead of rejecting them", async () => {
    let t = 0;
    const slept: number[] = [];
    const limiter = createRateLimiter({ musicbrainz: 1000 }, memoryRateStore(() => t), async (ms) => {
      slept.push(ms);
      t += ms;
    });
    const starts: number[] = [];
    for (let i = 0; i < 4; i++) {
      await limiter.acquire("musicbrainz");
      starts.push(t);
    }
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(1000);
  });

  it("lets only one of several simultaneous callers claim a slot", async () => {
    const store = memoryRateStore(() => 1000);
    const waits = await Promise.all([store.claim("p", 1000), store.claim("p", 1000), store.claim("p", 1000)]);
    expect(waits.filter((w) => w === 0)).toHaveLength(1);
    expect(waits.filter((w) => w > 0)).toHaveLength(2);
  });

  it("queues callers that arrive together, one interval apart, in real time", async () => {
    const limiter = createRateLimiter({ p: 40 }, memoryRateStore());
    const at: number[] = [];
    await Promise.all(Array.from({ length: 3 }, () => limiter.acquire("p").then(() => at.push(Date.now()))));
    at.sort((a, b) => a - b);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(30);
    expect(at[2] - at[1]).toBeGreaterThanOrEqual(30);
  });

  it("does not limit a provider with no interval, and keeps providers apart", async () => {
    const limiter = createRateLimiter({ a: 1000 }, memoryRateStore(() => 0), async () => {
      throw new Error("should not sleep");
    });
    await limiter.acquire("other");
    await limiter.acquire("other");
    await limiter.acquire("a");
    await expect(limiter.acquire("a")).rejects.toThrow();
  });

  it("gives up rather than waiting forever on a stuck store", async () => {
    const stuck = { claim: async () => RATE_WAIT_LIMIT_MS };
    const limiter = createRateLimiter({ p: 1000 }, stuck, async () => undefined);
    await expect(limiter.acquire("p")).rejects.toThrow(/too long/);
  });

  it("keeps MusicBrainz to one request a second", () => {
    expect(PROVIDER_MIN_INTERVAL_MS.musicbrainz).toBeGreaterThanOrEqual(1000);
  });
});

describe("cachedJsonGet", () => {
  const base = { provider: "p", url: "https://x.test/a?api_key=SECRET", cacheKey: "a", limiter: noLimit };

  it("asks once and answers the repeat from the cache, without taking a rate-limit slot", async () => {
    const { fetcher, calls } = router(() => json({ ok: 1 }));
    const acquire = vi.fn(async () => undefined);
    const opts = { ...base, fetcher, cache: memoryCache(), limiter: { acquire } };
    expect(await cachedJsonGet(opts)).toEqual({ ok: 1 });
    expect(await cachedJsonGet(opts)).toEqual({ ok: 1 });
    expect(calls).toHaveLength(1);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it("remembers that a lookup found nothing, so it is not asked again", async () => {
    const { fetcher, calls } = router(() => json({}, 404));
    const opts = { ...base, fetcher, cache: memoryCache() };
    expect(await cachedJsonGet(opts)).toBeNull();
    expect(await cachedJsonGet(opts)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("does not cache a failure, and the error never contains the URL (which can hold a key)", async () => {
    const { fetcher, calls } = router(() => json({}, 503));
    const cache = memoryCache();
    const opts = { ...base, fetcher, cache };
    await expect(cachedJsonGet(opts)).rejects.toBeInstanceOf(HttpError);
    await expect(cachedJsonGet(opts)).rejects.toThrow("p answered 503");
    expect(calls).toHaveLength(2);
    expect(cache.size()).toBe(0);
    const thrown = await cachedJsonGet({ ...opts, fetcher: async () => Promise.reject(new TypeError("boom SECRET")) }).catch((e: Error) => e.message);
    expect(thrown).not.toContain("SECRET");
  });

  it("expires a cached answer", async () => {
    let t = 0;
    const { fetcher, calls } = router(() => json({ n: calls.length }));
    const opts = { ...base, fetcher, cache: memoryCache(() => t) };
    await cachedJsonGet(opts);
    t += 31 * 24 * 60 * 60 * 1000;
    await cachedJsonGet(opts);
    expect(calls).toHaveLength(2);
  });
});

describe("FileTagProvider", () => {
  const at = 5;
  it("is 0.6 for a clean single match, lower for several genres or an unplaceable one", () => {
    expect(genreTagsFromFileTags(["Hip Hop/Rap"], at)).toEqual([{ genre: "Hip-Hop", source: "file-tags", confidence: FILE_TAG_CLEAN_CONFIDENCE, updatedAt: at }]);
    expect(genreTagsFromFileTags(["Rock", "Pop"], at).map((t) => t.confidence)).toEqual([0.45, 0.45]);
    expect(genreTagsFromFileTags(["Rock; Pop; Jazz"], at).map((t) => t.confidence)).toEqual([0.4, 0.4, 0.4]);
    expect(genreTagsFromFileTags(["Rock", "Pop", "Jazz", "Blues", "Folk"], at).every((t) => t.confidence === 0.3)).toBe(true);
    expect(genreTagsFromFileTags(["Rock", "my own thing"], at)[0].confidence).toBe(0.5);
    expect(genreTagsFromFileTags(["(17)"], at)[0]).toMatchObject({ genre: "Rock", confidence: 0.5 });
  });
  it("gives a subgenre tag its subgenre, and no tags for junk", () => {
    expect(genreTagsFromFileTags(["Trap Music"], at)[0]).toMatchObject({ genre: "Hip-Hop", subgenre: "Trap" });
    expect(genreTagsFromFileTags(["Other", "", "1994"], at)).toEqual([]);
    expect(genreTagsFromFileTags(["Rock", "rock", "Rock"], at)).toHaveLength(1);
  });
  it("reads the file's tags through the injected reader and passes the album and year on", async () => {
    const provider = createFileTagProvider({ readTags: async () => ({ genres: ["Jazz"], album: "Blue", year: 1959 }), now: () => at });
    const r = await provider.classify(input);
    expect(r.tags).toHaveLength(1);
    expect(r.meta).toEqual({ album: "Blue", year: 1959 });
  });
  it("says why it found nothing, and never throws", async () => {
    const none = createFileTagProvider({ readTags: async () => ({ genres: [] }) });
    expect((await none.classify(input)).note).toMatch(/no genre tag/);
    const junk = createFileTagProvider({ readTags: async () => ({ genres: ["zzz"] }) });
    expect((await junk.classify(input)).note).toMatch(/names nothing/);
    const broken = createFileTagProvider({ readTags: async () => Promise.reject(new Error("corrupt")) });
    expect((await broken.classify(input)).note).toMatch(/corrupt/);
    const unreadable = createFileTagProvider({ readTags: async () => null });
    expect((await unreadable.classify(input)).tags).toEqual([]);
    expect((await createFileTagProvider({ readTags: async () => ({ genres: ["Jazz"] }) }).classify({ ...input, source: "youtube", storageKey: undefined })).note).toMatch(/no audio file/);
  });
});

describe("MusicBrainzProvider", () => {
  const search = {
    recordings: [
      { id: "wrong", title: "Tiny Dancer (Live)", score: 100, "artist-credit": [{ artist: { id: "a1", name: "Elton John" } }] },
      { id: "low", title: "Tiny Dancer", score: 60, "artist-credit": [{ artist: { id: "a1", name: "Elton John" } }] },
      { id: "rec1", title: "Tiny Dancer", score: 100, "artist-credit": [{ artist: { id: "a1", name: "Elton John" } }] },
    ],
  };
  const recording = {
    id: "rec1",
    title: "Tiny Dancer",
    genres: [{ name: "soft rock", count: 3 }, { name: "pop rock", count: 1 }],
    tags: [{ name: "seen live", count: 5 }, { name: "1971", count: 2 }, { name: "piano rock", count: 1 }],
    "artist-credit": [{ artist: { id: "a1", name: "Elton John" } }],
  };
  const artist = { genres: [{ name: "rock", count: 12 }, { name: "pop", count: 2 }], tags: [] };
  const handle = (url: string) => {
    if (url.includes("/recording?query")) return json(search);
    if (url.includes("/recording/rec1")) return json(recording);
    if (url.includes("/artist/a1")) return json(artist);
    return undefined;
  };
  const make = (h = handle, extra: { cache?: ReturnType<typeof memoryCache>; limiter?: { acquire: () => Promise<void> } } = {}) => {
    const r = router(h);
    const provider = createMusicBrainzProvider({ fetcher: r.fetcher, cache: extra.cache ?? memoryCache(), limiter: extra.limiter ?? noLimit, userAgent: UA, now: () => 9 });
    return { ...r, provider };
  };

  it("finds the right recording, reads its genres and its artist's, and drops names that are not genres", async () => {
    const { provider } = make();
    const r = await provider.classify(input);
    expect(r.meta?.recordingMbid).toBe("rec1");
    const byKey = Object.fromEntries(r.tags.map((t) => [`${t.genre}/${t.subgenre ?? ""}`, t.confidence]));
    expect(byKey["Rock/Soft Rock"]).toBeCloseTo(recordingConfidence(3));
    expect(byKey["Rock/Pop Rock"]).toBeCloseTo(recordingConfidence(1));
    expect(byKey["Rock/"]).toBeCloseTo(artistConfidence(12));
    expect(byKey["Pop/"]).toBeDefined();
    expect(Object.keys(byKey).join()).not.toMatch(/seen live|1971/);
    expect(r.tags.every((t) => t.source === "musicbrainz" && t.updatedAt === 9)).toBe(true);
    expect(r.tags[0].confidence).toBeGreaterThanOrEqual(r.tags[r.tags.length - 1].confidence);
  });

  it("identifies the app in every request, and only takes a rate-limit slot for a real request", async () => {
    const acquire = vi.fn(async () => undefined);
    const cache = memoryCache();
    const first = make(handle, { cache, limiter: { acquire } });
    await first.provider.classify(input);
    expect(first.calls.length).toBe(3);
    for (const c of first.calls) expect((c.init?.headers as Record<string, string>)["User-Agent"]).toBe(UA);
    expect(acquire).toHaveBeenCalledTimes(3);
    const second = make(handle, { cache, limiter: { acquire } });
    await second.provider.classify(input);
    expect(second.calls).toHaveLength(0);
    expect(acquire).toHaveBeenCalledTimes(3);
  });

  it("uses a recording id it was given instead of searching", async () => {
    const { provider, calls } = make();
    await provider.classify({ ...input, recordingMbid: "rec1" });
    expect(calls.some((c) => c.url.includes("/recording?query"))).toBe(false);
  });

  it("does not accept a near miss: wrong title, wrong artist or a low score finds nothing", async () => {
    const miss = (rec: object) => make((url) => (url.includes("/recording?query") ? json({ recordings: [rec] }) : undefined));
    const base = { id: "x", title: "Tiny Dancer", score: 100, "artist-credit": [{ artist: { id: "a", name: "Elton John" } }] };
    for (const rec of [{ ...base, title: "Something Else" }, { ...base, score: 80 }, { ...base, "artist-credit": [{ artist: { id: "a", name: "Someone Else" } }] }]) {
      const r = await miss(rec).provider.classify(input);
      expect(r.tags).toEqual([]);
      expect(r.note).toMatch(/no matching recording/);
    }
  });

  it("does not search for an unknown artist", async () => {
    const { provider, calls } = make();
    const r = await provider.classify({ ...input, artist: "Unknown Artist" });
    expect(calls).toHaveLength(0);
    expect(r.tags).toEqual([]);
  });

  it("returns an empty result with a note when MusicBrainz is down", async () => {
    const { provider } = make(() => json({}, 503));
    const r = await provider.classify(input);
    expect(r.tags).toEqual([]);
    expect(r.note).toMatch(/503/);
  });

  it("escapes quotes in the title so the search query is not broken", async () => {
    const { provider, calls } = make();
    await provider.classify({ ...input, title: 'He said "hi"' });
    expect(decodeURIComponent(calls[0].url)).toContain('recording:"He said \\"hi\\""');
  });
});

describe("LastFmProvider", () => {
  const trackBody = { toptags: { tag: [{ name: "hip-hop", count: 100 }, { name: "seen live", count: 80 }, { name: "chill", count: 60 }, { name: "2010", count: 50 }, { name: "trap", count: 30 }, { name: "mellow", count: 10 }] } };
  const artistBody = { toptags: { tag: [{ name: "Hip-Hop", count: 100 }, { name: "rnb", count: 40 }, { name: "female vocalists", count: 30 }] } };
  const handle = (url: string) => (url.includes("track.gettoptags") ? json(trackBody) : url.includes("artist.gettoptags") ? json(artistBody) : undefined);
  const make = (h = handle, key: string | null = "K3Y", cache = memoryCache()) => {
    const r = router(h);
    return { ...r, cache, provider: createLastFmProvider({ fetcher: r.fetcher, cache, limiter: noLimit, userAgent: UA, apiKey: () => key ?? undefined, now: () => 3 }) };
  };

  it("sorts tags into genres, moods and noise", async () => {
    const r = await make().provider.classify(input);
    const genres = r.tags.map((t) => `${t.genre}/${t.subgenre ?? ""}`);
    expect(genres).toEqual(expect.arrayContaining(["Hip-Hop/", "Hip-Hop/Trap", "R&B/"]));
    expect(genres.join()).not.toMatch(/seen live|2010|female/);
    expect(r.moods).toContain("chill");
        expect(r.tags.find((t) => t.genre === "Hip-Hop" && !t.subgenre)!.confidence).toBeCloseTo(trackTagConfidence(100));
    expect(r.tags.every((t) => t.source === "lastfm")).toBe(true);
  });

  it("keeps the API key out of the cache and out of the cache key", async () => {
    const { provider, cache, calls } = make();
    await provider.classify(input);
    expect(calls.every((c) => c.url.includes("api_key=K3Y"))).toBe(true);
    const keys: string[] = [];
    const spy = { ...cache, set: async (k: string, p: string, v: unknown, ttl: number) => { keys.push(k); await cache.set(k, p, v, ttl); } };
    const r = router(handle);
    await createLastFmProvider({ fetcher: r.fetcher, cache: spy, limiter: noLimit, userAgent: UA, apiKey: () => "K3Y" }).classify({ ...input, title: "Other" });
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join()).not.toContain("K3Y");
  });

  it("does nothing, without calling out, when there is no key or no artist", async () => {
    const noKey = make(handle, null);
    expect((await noKey.provider.classify(input)).note).toMatch(/LASTFM_API_KEY/);
    expect(noKey.calls).toHaveLength(0);
    const noArtist = make();
    await noArtist.provider.classify({ ...input, artist: "" });
    expect(noArtist.calls).toHaveLength(0);
  });

  it("treats Last.fm's 'not found' answer (a 200 with an error body) as no tags", async () => {
    const r = await make(() => json({ error: 6, message: "Track not found" })).provider.classify(input);
    expect(r.tags).toEqual([]);
    expect(r.moods).toEqual([]);
  });

  it("copes with a single tag sent as an object, and with a failure", async () => {
    const one = await make(() => json({ toptags: { tag: { name: "jazz", count: 90 } } })).provider.classify(input);
    expect(one.tags[0].genre).toBe("Jazz");
    const down = await make(() => json({}, 500)).provider.classify(input);
    expect(down.tags).toEqual([]);
    expect(down.note).toMatch(/500/);
  });
});

describe("FingerprintProvider", () => {
  const fp = async (): Promise<{ durationSec: number; fingerprint: string } | null> => ({ durationSec: 200.4, fingerprint: "AQAA" });
  const make = (opts: { fingerprinter?: (() => Promise<{ durationSec: number; fingerprint: string } | null>) | null; key?: string | undefined; body?: object } = {}) => {
    const r = router(() => json(opts.body ?? { status: "ok", results: [{ id: "x", score: 0.95, recordings: [{ id: "rec9" }] }] }));
    const resolver = createFingerprintResolver({
      fingerprinter: opts.fingerprinter === undefined ? fp : opts.fingerprinter,
      fetcher: r.fetcher,
      cache: memoryCache(),
      limiter: noLimit,
      userAgent: UA,
      apiKey: () => ("key" in opts ? opts.key : "AK"),
    });
    return { ...r, resolver };
  };

  it("resolves a fingerprint to a MusicBrainz recording id, with the fingerprint in the body and not the URL", async () => {
    const { resolver, calls } = make();
    const m = await resolver.resolve(input);
    expect(m).toEqual({ recordingMbid: "rec9", score: 0.95 });
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].url).not.toContain("AQAA");
    expect(String(calls[0].init?.body)).toContain("fingerprint=AQAA");
    expect(String(calls[0].init?.body)).toContain("duration=200");
  });
  it("does not trust a weak match", async () => {
    const m = await make({ body: { results: [{ score: MIN_FINGERPRINT_SCORE - 0.05, recordings: [{ id: "r" }] }] } }).resolver.resolve(input);
    expect(m.recordingMbid).toBeNull();
  });
  it("is off without the tool, the key or a file, and never throws", async () => {
    expect((await make({ fingerprinter: null }).resolver.resolve(input)).note).toMatch(/FPCALC_PATH/);
    expect((await make({ key: undefined }).resolver.resolve(input)).note).toMatch(/ACOUSTID_API_KEY/);
    expect((await make().resolver.resolve({ ...input, source: "youtube", storageKey: undefined })).note).toMatch(/no audio file/);
    expect((await make({ fingerprinter: async () => null }).resolver.resolve(input)).recordingMbid).toBeNull();
    expect((await make({ fingerprinter: async () => Promise.reject(new Error("x")) }).resolver.resolve(input)).recordingMbid).toBeNull();
  });
});

describe("AudioClassifierProvider", () => {
  const model = (preds: { label: string; probability: number }[]) => ({ name: "test-model", license: "MIT", predict: async () => preds });
  it("is gated by CLASSIFIER_ENABLED and off unless it is exactly 'true'", () => {
    expect(isClassifierEnabled({})).toBe(false);
    expect(isClassifierEnabled({ CLASSIFIER_ENABLED: "false" })).toBe(false);
    expect(isClassifierEnabled({ CLASSIFIER_ENABLED: "1" })).toBe(false);
    expect(isClassifierEnabled({ CLASSIFIER_ENABLED: "true" })).toBe(true);
  });
  it("returns nothing while disabled, without calling the model", async () => {
    const predict = vi.fn(async () => [{ label: "rock", probability: 0.9 }]);
    const p = createAudioClassifierProvider({ enabled: () => false, model: { name: "m", license: "x", predict } });
    expect((await p.classify(input)).tags).toEqual([]);
    expect(predict).not.toHaveBeenCalled();
  });
  it("is empty, not an error, when no model is installed", async () => {
    const r = await createAudioClassifierProvider({ enabled: () => true, model: null }).classify(input);
    expect(r.tags).toEqual([]);
    expect(r.note).toMatch(/no audio genre model/);
  });
  it("trusts a top-level genre more than a subgenre", async () => {
    const p = createAudioClassifierProvider({
      enabled: () => true,
      now: () => 1,
      model: model([{ label: "Hip Hop---Trap", probability: 0.95 }, { label: "Rock", probability: 0.99 }, { label: "Jazz", probability: 0.05 }, { label: "Nonsense---Thing", probability: 0.9 }]),
    });
    const r = await p.classify(input);
    const trap = r.tags.find((t) => t.subgenre === "Trap")!;
    const rock = r.tags.find((t) => t.genre === "Rock")!;
    expect(trap.confidence).toBe(CLASSIFIER_SUBGENRE_CAP);
    expect(rock.confidence).toBe(CLASSIFIER_GENRE_CAP);
    expect(r.tags.find((t) => t.genre === "Jazz")).toBeUndefined();
    expect(r.tags.every((t) => t.source === "audio-classifier")).toBe(true);
  });
  it("maps a 'Genre---Style' label to the style if the taxonomy has it, else the genre", () => {
    expect(nodesFromModelLabel("Electronic---House")).toEqual({ genre: "Electronic", subgenre: "House" });
    expect(nodesFromModelLabel("Rock---Zzzz")).toEqual({ genre: "Rock" });
    expect(nodesFromModelLabel("Zzzz---Yyyy")).toBeNull();
  });
  it("catches a model that fails", async () => {
    const p = createAudioClassifierProvider({ enabled: () => true, model: { name: "m", license: "x", predict: async () => Promise.reject(new Error("oom")) } });
    expect((await p.classify(input)).note).toMatch(/oom/);
  });
});

describe("LlmReconcilerProvider", () => {
  const ok = (toolInput: unknown) => json({ content: [{ type: "text", text: "..." }, { type: "tool_use", name: "report_genres", input: toolInput }] });
  const evidence = [{ source: "file-tags" as const, tags: [{ genre: "Pop", confidence: 0.6, source: "file-tags" as const, updatedAt: 1 }] }, { source: "lastfm" as const, tags: [{ genre: "Rock", confidence: 0.7, source: "lastfm" as const, updatedAt: 1 }], moods: ["chill"] }];

  it("is told the taxonomy in a cached block, must answer through the tool, and uses Haiku", async () => {
    const r = router(() => ok({ genres: [{ genre: "Rock", subgenre: "Soft Rock", confidence: 0.7 }], moods: ["chill"], reason: "Classic." }));
    const p = createLlmReconciler({ fetcher: r.fetcher, cache: memoryCache(), apiKey: () => "KEY", now: () => 4 });
    const out = await p.classify({ ...input, album: "Madman", year: 1971, evidence });
    const body = JSON.parse(String(r.calls[0].init?.body));
    expect(body.model).toBe(GENRE_LLM_MODEL);
    expect(GENRE_LLM_MODEL).toMatch(/haiku/);
    expect(body.tool_choice).toEqual({ type: "tool", name: "report_genres" });
    expect(body.tools[0].input_schema.properties.genres.items.properties.genre.enum).toEqual([...genreLabels()]);
    expect(body.system.some((b: { cache_control?: unknown; text: string }) => b.cache_control && b.text.includes(taxonomyPrompt()))).toBe(true);
    expect(body.system[0].text).toMatch(/unknown/);
    const sent = JSON.parse(body.messages[0].content);
    expect(sent).toMatchObject({ title: "Tiny Dancer", artist: "Elton John", album: "Madman", year: 1971 });
    expect(sent.sources.map((s: { source: string }) => s.source)).toEqual(["file-tags", "lastfm"]);
    expect((r.calls[0].init?.headers as Record<string, string>)["x-api-key"]).toBe("KEY");
    expect(out.tags).toEqual([{ genre: "Rock", subgenre: "Soft Rock", source: "llm", confidence: 0.7, updatedAt: 4 }]);
    expect(out.moods).toEqual(["chill"]);
  });

  it("drops anything that is not on the taxonomy and clamps confidence", () => {
    const v = validateReconcile(
      {
        genres: [
          { genre: "Rock", subgenre: "Polka Rock", confidence: 0.99 },
          { genre: "Polka", confidence: 0.9 },
          { genre: "Pop", confidence: "high" },
          { genre: "Jazz", confidence: 0 },
          { genre: 5, confidence: 0.5 },
        ],
        moods: ["chill", "angsty", "Mellow", 7],
        reason: "x".repeat(1000),
      },
      1
    );
    expect(v.tags).toEqual([{ genre: "Rock", source: "llm", confidence: LLM_CONFIDENCE_CAP, updatedAt: 1 }]);
    expect(v.moods).toEqual(["chill"]);
    expect(v.reason).toHaveLength(300);
    expect(validateReconcile(null, 1)).toEqual({ tags: [], moods: [], reason: "" });
  });

  it("returns no genres, with the reason, when the model says unknown", async () => {
    const r = router(() => ok({ genres: [], moods: [], reason: "unknown" }));
    const out = await createLlmReconciler({ fetcher: r.fetcher, cache: memoryCache(), apiKey: () => "KEY" }).classify({ ...input, evidence: [] });
    expect(out.tags).toEqual([]);
    expect(out.note).toMatch(/did not guess: unknown/);
  });

  it("asks once for the same question", async () => {
    const r = router(() => ok({ genres: [{ genre: "Pop", confidence: 0.6 }], moods: [], reason: "" }));
    const p = createLlmReconciler({ fetcher: r.fetcher, cache: memoryCache(), apiKey: () => "KEY" });
    await p.classify({ ...input, evidence });
    await p.classify({ ...input, evidence });
    expect(r.calls).toHaveLength(1);
  });

  it("is off without a key, and empty when the call fails or gives no tool answer", async () => {
    const r = router(() => ok({}));
    expect((await createLlmReconciler({ fetcher: r.fetcher, cache: memoryCache(), apiKey: () => undefined }).classify(input)).note).toMatch(/ANTHROPIC_API_KEY/);
    expect(r.calls).toHaveLength(0);
    expect((await createLlmReconciler({ fetcher: router(() => json({}, 529)).fetcher, cache: memoryCache(), apiKey: () => "K" }).classify(input)).note).toMatch(/529/);
    expect((await createLlmReconciler({ fetcher: router(() => json({ content: [{ type: "text", text: "hi" }] })).fetcher, cache: memoryCache(), apiKey: () => "K" }).classify(input)).note).toMatch(/no answer/);
    const boom = createLlmReconciler({ fetcher: async () => Promise.reject(new Error("net")), cache: memoryCache(), apiKey: () => "K" });
    expect((await boom.classify(input)).tags).toEqual([]);
  });
});

describe("moodTags", () => {
  it("collapses mood words and ignores the rest", () => {
    expect(normalizeMood("Mellow")).toBe("chill");
    expect(normalizeMood("workout")).toBe("workout");
    expect(normalizeMood("Late Night")).toBe("late-night");
    expect(normalizeMood("seen live")).toBeNull();
    expect(normalizeMood("hip-hop")).toBeNull();
    expect(normalizeMood("")).toBeNull();
    expect(normalizeMood(null)).toBeNull();
  });
});
