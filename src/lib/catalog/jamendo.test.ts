import { describe, expect, it, vi } from "vitest";
import { ADAPTATION_NOTE, attributionFor } from "@/lib/catalog/attribution";
import {
  JAMENDO_FETCH_MULTIPLIER,
  JAMENDO_MAX_FETCHES,
  JAMENDO_MAX_LIMIT,
  buildJamendoSearchUrl,
  createJamendoAdapter,
  isJamendoHost,
  parseJamendoResults,
  parseJamendoTrack,
} from "@/lib/catalog/jamendo";
import { CatalogSourceError } from "@/lib/catalog/types";

const CC_BY = "https://creativecommons.org/licenses/by/4.0/";
const CC_BY_NC = "https://creativecommons.org/licenses/by-nc/3.0/";

/** A track the way Jamendo's /tracks?include=musicinfo sends it. */
function raw(overrides: Record<string, unknown> = {}) {
  return {
    id: "1234567",
    name: "Neon Tide",
    duration: 214,
    artist_id: "55",
    artist_name: "Kite Runner",
    album_name: "Night Shift",
    album_image: "https://usercontent.jamendo.com/?type=album&id=9&width=300",
    image: "https://usercontent.jamendo.com/?type=track&id=1234567&width=300",
    license_ccurl: CC_BY,
    audio: "https://prod-1.storage.jamendo.com/?trackid=1234567&format=mp32",
    audiodownload: "https://prod-1.storage.jamendo.com/download/track/1234567/mp32/",
    audiodownload_allowed: true,
    shareurl: "https://www.jamendo.com/track/1234567",
    musicinfo: {
      vocalinstrumental: "instrumental",
      speed: "high",
      tags: { genres: ["electronic", "house"], instruments: ["synthesizer"], vartags: ["driving"] },
    },
    ...overrides,
  };
}

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const page = (results: unknown[]) => ({ headers: { status: "success", code: 0, results_count: results.length }, results });

describe("buildJamendoSearchUrl", () => {
  it("builds the request with the key, JSON, the better audio format and music info", () => {
    const url = new URL(buildJamendoSearchUrl({ text: "  deep house  " }, "abc123"));
    expect(url.origin + url.pathname).toBe("https://api.jamendo.com/v3.0/tracks/");
    expect(url.searchParams.get("client_id")).toBe("abc123");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("search")).toBe("deep house");
    expect(url.searchParams.get("include")).toBe("musicinfo");
    expect(url.searchParams.get("audioformat")).toBe("mp32");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("offset")).toBe("0");
  });

  it("writes list filters with the + Jamendo reads as a separator", () => {
    const query = { tags: ["rock", "pop"], speed: ["high", "veryhigh"], vocal: "instrumental" as const };
    const href = buildJamendoSearchUrl(query, "k");
    expect(href).toContain("tags=rock+pop");
    expect(href).toContain("speed=high+veryhigh");
    expect(href).toContain("vocalinstrumental=instrumental");
    expect(href).toContain("type=single+albumtrack");
  });

  it("clamps the page size and offset, and sends a duration window only when it is sensible", () => {
    expect(new URL(buildJamendoSearchUrl({ limit: 9999 }, "k")).searchParams.get("limit")).toBe(String(JAMENDO_MAX_LIMIT));
    expect(new URL(buildJamendoSearchUrl({ limit: 0 }, "k")).searchParams.get("limit")).toBe("1");
    expect(new URL(buildJamendoSearchUrl({ offset: -5 }, "k")).searchParams.get("offset")).toBe("0");
    expect(new URL(buildJamendoSearchUrl({ minDurationSec: 90, maxDurationSec: 420 }, "k")).searchParams.get("durationbetween")).toBe("90_420");
    expect(new URL(buildJamendoSearchUrl({ minDurationSec: 90 }, "k")).searchParams.get("durationbetween")).toBe("90_3600");
    expect(new URL(buildJamendoSearchUrl({ minDurationSec: 400, maxDurationSec: 100 }, "k")).searchParams.has("durationbetween")).toBe(false);
  });

  it("leaves out empty filters", () => {
    const url = new URL(buildJamendoSearchUrl({ text: "  ", tags: [], speed: [] }, "k"));
    for (const name of ["search", "tags", "speed", "vocalinstrumental", "durationbetween"]) expect(url.searchParams.has(name), name).toBe(false);
  });
});

describe("isJamendoHost", () => {
  it("accepts Jamendo's own hosts and their subdomains", () => {
    for (const host of ["jamendo.com", "www.jamendo.com", "prod-1.storage.jamendo.com", "usercontent.jamendo.com", "API.Jamendo.COM", "imgjam.com", "img.imgjam.com"]) {
      expect(isJamendoHost(host), host).toBe(true);
    }
  });
  it("rejects look-alikes and everything else", () => {
    for (const host of ["evil-jamendo.com", "jamendo.com.evil.example", "notjamendo.com", "jamendo.co", "example.com", "", "localhost"]) {
      expect(isJamendoHost(host), host).toBe(false);
    }
  });
});

describe("parseJamendoTrack", () => {
  it("maps a usable track", () => {
    const parsed = parseJamendoTrack(raw());
    expect("track" in parsed).toBe(true);
    if (!("track" in parsed)) return;
    expect(parsed.track).toMatchObject({
      id: "jamendo:1234567",
      source: "jamendo",
      sourceId: "1234567",
      title: "Neon Tide",
      artist: "Kite Runner",
      album: "Night Shift",
      durationSec: 214,
      streamUrl: "https://prod-1.storage.jamendo.com/?trackid=1234567&format=mp32",
      downloadUrl: "https://prod-1.storage.jamendo.com/download/track/1234567/mp32/",
      imageUrl: "https://usercontent.jamendo.com/?type=track&id=1234567&width=300",
      pageUrl: "https://www.jamendo.com/track/1234567",
      tags: ["electronic", "house", "synthesizer", "driving"],
      speed: "high",
      vocal: "instrumental",
    });
    expect(parsed.track.license.code).toBe("by");
  });

  it("accepts a numeric id and a duration sent as a string", () => {
    const parsed = parseJamendoTrack(raw({ id: 42, duration: "180" }));
    expect("track" in parsed && parsed.track.id).toBe("jamendo:42");
    expect("track" in parsed && parsed.track.durationSec).toBe(180);
  });

  it("drops the download link unless the source allows downloads", () => {
    const denied = parseJamendoTrack(raw({ audiodownload_allowed: false }));
    expect("track" in denied && denied.track.downloadUrl).toBeUndefined();
    const missing = parseJamendoTrack(raw({ audiodownload_allowed: undefined }));
    expect("track" in missing && missing.track.downloadUrl).toBeUndefined();
  });

  it("falls back for missing artist, album and image, and ignores a non-https link", () => {
    const parsed = parseJamendoTrack(raw({ artist_name: " ", album_name: "", image: "", album_image: "http://usercontent.jamendo.com/a.jpg", shareurl: "javascript:alert(1)" }));
    expect("track" in parsed).toBe(true);
    if (!("track" in parsed)) return;
    expect(parsed.track.artist).toBe("Unknown Artist");
    expect(parsed.track.album).toBeUndefined();
    expect(parsed.track.imageUrl).toBeUndefined();
    expect(parsed.track.pageUrl).toBeUndefined();
  });

  it("passes on only links on Jamendo's own hosts", () => {
    const parsed = parseJamendoTrack(
      raw({
        image: "https://evil.example/pixel.png",
        album_image: "https://jamendo.com.evil.example/a.jpg",
        shareurl: "https://evil-jamendo.com/track/1",
        audiodownload: "https://evil.example/download.mp3",
      })
    );
    expect("track" in parsed).toBe(true);
    if (!("track" in parsed)) return;
    expect(parsed.track.imageUrl).toBeUndefined();
    expect(parsed.track.pageUrl).toBeUndefined();
    expect(parsed.track.downloadUrl).toBeUndefined();
  });

  it("leaves out a track whose audio is not on Jamendo's hosts (it can't be played from there)", () => {
    expect(parseJamendoTrack(raw({ audio: "https://evil.example/stream.mp3" }))).toEqual({ skipped: "invalid" });
    expect(parseJamendoTrack(raw({ audio: "https://prod-1.storage.jamendo.com.evil.example/x" }))).toEqual({ skipped: "invalid" });
  });

  it("removes an explicit client_id parameter from the links it hands on, and leaves every other parameter alone", () => {
    const parsed = parseJamendoTrack(
      raw({
        audio: "https://prod-1.storage.jamendo.com/?trackid=1&client_id=secret-key&format=mp32",
        shareurl: "https://www.jamendo.com/track/1?client_id=secret-key",
      })
    );
    if (!("track" in parsed)) throw new Error("fixture should parse");
    expect(parsed.track.streamUrl).toBe("https://prod-1.storage.jamendo.com/?trackid=1&format=mp32");
    expect(parsed.track.pageUrl).toBe("https://www.jamendo.com/track/1");
  });

  it("passes a `from=app-<id>` style parameter through unchanged, because the stream may need it (scripts/check-jamendo.ts settles whether it does)", () => {
    const parsed = parseJamendoTrack(raw({ audio: "https://prod-1.storage.jamendo.com/?trackid=1&format=mp32&from=app-97dab294" }));
    if (!("track" in parsed)) throw new Error("fixture should parse");
    expect(parsed.track.streamUrl).toContain("from=app-97dab294");
  });

  it("skips what can't be played", () => {
    for (const bad of [
      { id: "" },
      { id: undefined },
      { name: " " },
      { audio: "" },
      { audio: "http://prod-1.storage.jamendo.com/?trackid=1" },
      { audio: "javascript:alert(1)" },
      { audio: "not a url" },
      { duration: 0 },
      { duration: -3 },
      { duration: "soon" },
      { duration: undefined },
    ]) {
      expect(parseJamendoTrack(raw(bad)), JSON.stringify(bad)).toEqual({ skipped: "invalid" });
    }
  });

  it("skips a track whose license the app can't use, saying why", () => {
    expect(parseJamendoTrack(raw({ license_ccurl: "http://creativecommons.org/licenses/by-nc-sa/3.0/" }))).toEqual({ skipped: "non-commercial" });
    expect(parseJamendoTrack(raw({ license_ccurl: "https://creativecommons.org/licenses/by-nd/4.0/" }))).toEqual({ skipped: "no-derivatives" });
    expect(parseJamendoTrack(raw({ license_ccurl: "https://creativecommons.org/licenses/by-sa/4.0/" }))).toEqual({ skipped: "share-alike" });
    expect(parseJamendoTrack(raw({ license_ccurl: "" }))).toEqual({ skipped: "unknown" });
    expect(parseJamendoTrack(raw({ license_ccurl: undefined }))).toEqual({ skipped: "unknown" });
    expect("track" in parseJamendoTrack(raw({ license_ccurl: "https://creativecommons.org/licenses/by-sa/4.0/" }), { allowShareAlike: true })).toBe(true);
  });
});

describe("parseJamendoResults", () => {
  it("gives one outcome per result, in Jamendo's order", () => {
    const outcomes = parseJamendoResults(page([raw({ id: "1" }), raw({ id: "2", license_ccurl: CC_BY_NC }), raw({ id: "3", audio: "" }), raw({ id: "4" })]));
    expect(outcomes.map((o) => ("track" in o ? o.track.id : `skipped:${o.skipped}`))).toEqual(["jamendo:1", "skipped:non-commercial", "skipped:invalid", "jamendo:4"]);
  });

  it("throws on a failure Jamendo reports with HTTP 200, and on a body that is not a result list", () => {
    const failed = { headers: { status: "failed", code: 5, error_message: "Invalid client_id" }, results: [] };
    expect(() => parseJamendoResults(failed)).toThrow(CatalogSourceError);
    expect(() => parseJamendoResults(failed)).toThrow(/Invalid client_id/);
    expect(() => parseJamendoResults({})).toThrow(CatalogSourceError);
    expect(() => parseJamendoResults(null)).toThrow(CatalogSourceError);
    expect(() => parseJamendoResults({ results: "nope" })).toThrow(CatalogSourceError);
  });

  it("copes with a null entry in the results", () => {
    const outcomes = parseJamendoResults(page([null, raw({ id: "1" })]));
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toEqual({ skipped: "invalid" });
  });
});

/** Serves `all` the way Jamendo does: whatever slice the request's offset and limit ask for. */
function serve(all: unknown[]) {
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset"));
    return ok(page(all.slice(offset, offset + limit)));
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, mock: fetchImpl };
}
const requests = (mock: ReturnType<typeof serve>["mock"]) =>
  mock.mock.calls.map((c) => {
    const url = new URL(String(c[0]));
    return { limit: Number(url.searchParams.get("limit")), offset: Number(url.searchParams.get("offset")) };
  });
/** `n` tracks of which every `every`-th is usable (CC BY); the rest are NonCommercial. */
const catalog = (n: number, every = 1) => Array.from({ length: n }, (_, i) => raw({ id: String(i + 1), license_ccurl: (i + 1) % every === 0 ? CC_BY : CC_BY_NC }));

describe("createJamendoAdapter", () => {
  it("searches with the key and returns only usable tracks", async () => {
    const { fetchImpl, mock } = serve([raw({ id: "1" }), raw({ id: "2", license_ccurl: "https://creativecommons.org/licenses/by-nd/4.0/" })]);
    const adapter = createJamendoAdapter({ clientId: "secret-key", fetchImpl });
    const result = await adapter.search({ text: "house" });
    expect(adapter.id).toBe("jamendo");
    expect(result.tracks.map((t) => t.id)).toEqual(["jamendo:1"]);
    expect(result.skipped.license).toBe(1);
    const calledWith = String((mock.mock.calls[0] as unknown[])[0]);
    expect(calledWith).toContain("client_id=secret-key");
    expect(calledWith).toContain("search=house");
  });

  it("refuses to be built without a client id", () => {
    expect(() => createJamendoAdapter({ clientId: "  " })).toThrow(CatalogSourceError);
  });

  it("asks for a bigger page than it needs, since most of the catalog is filtered out, and stops as soon as it has enough", async () => {
    const { fetchImpl, mock } = serve(catalog(100));
    const result = await createJamendoAdapter({ clientId: "k", fetchImpl }).search({ limit: 5 });
    expect(requests(mock)).toEqual([{ limit: 5 * JAMENDO_FETCH_MULTIPLIER, offset: 0 }]);
    expect(result.tracks).toHaveLength(5);
    expect(result.nextOffset).toBe(5); // it read exactly as far as the fifth track
  });

  it("reads on until it has enough usable tracks, and says where the next page starts (the raw position after the last one used)", async () => {
    // Every third track is usable: 4 usable tracks need reading up to raw track 12, inside one fetch of 12.
    const { fetchImpl, mock } = serve(catalog(100, 3));
    const result = await createJamendoAdapter({ clientId: "k", fetchImpl }).search({ limit: 4 });
    expect(requests(mock)).toHaveLength(1);
    expect(result.tracks.map((t) => t.id)).toEqual(["jamendo:3", "jamendo:6", "jamendo:9", "jamendo:12"]);
    expect(result.nextOffset).toBe(12);
    expect(result.skipped).toEqual({ invalid: 0, license: 8 });
  });

  it("fetches again when one page of a thin catalog isn't enough, but never more than a few times", async () => {
    const { fetchImpl, mock } = serve(catalog(1000, 10)); // 1 in 10 usable: a fetch of 15 yields 1 or 2
    const result = await createJamendoAdapter({ clientId: "k", fetchImpl }).search({ limit: 5 });
    expect(requests(mock)).toEqual([
      { limit: 15, offset: 0 },
      { limit: 15, offset: 15 },
      { limit: 15, offset: 30 },
    ]);
    expect(requests(mock)).toHaveLength(JAMENDO_MAX_FETCHES);
    expect(result.tracks.length).toBeLessThan(5); // a thin page, honestly reported
    expect(result.nextOffset).toBe(45); // and the next page carries on from where it stopped
  });

  it("ends the results on a short page that was read to its end", async () => {
    const { fetchImpl } = serve(catalog(7));
    const result = await createJamendoAdapter({ clientId: "k", fetchImpl }).search({ limit: 20 });
    expect(result.tracks).toHaveLength(7);
    expect(result.nextOffset).toBeNull();
  });

  it("does not end the results when it stopped inside a short page with tracks left in it", async () => {
    const { fetchImpl } = serve(catalog(12)); // a fetch of 15 returns 12; only 5 are wanted
    const result = await createJamendoAdapter({ clientId: "k", fetchImpl }).search({ limit: 5 });
    expect(result.tracks).toHaveLength(5);
    expect(result.nextOffset).toBe(5);
  });

  it("pages through everything without repeating or missing a usable track", async () => {
    const all = catalog(60, 4);
    const usable = all.filter((r) => r.license_ccurl === CC_BY).map((r) => `jamendo:${r.id}`);
    const { fetchImpl } = serve(all);
    const adapter = createJamendoAdapter({ clientId: "k", fetchImpl });
    const seen: string[] = [];
    let offset: number | null = 0;
    for (let i = 0; i < 20 && offset !== null; i++) {
      const result = await adapter.search({ limit: 4, offset });
      seen.push(...result.tracks.map((t) => t.id));
      offset = result.nextOffset;
    }
    expect(offset).toBeNull();
    expect(seen).toEqual(usable);
  });

  it("counts only what it read in what it left out", async () => {
    const { fetchImpl } = serve([raw({ id: "1" }), raw({ id: "2", license_ccurl: CC_BY_NC }), raw({ id: "3", audio: "" }), raw({ id: "4" }), raw({ id: "5", license_ccurl: CC_BY_NC })]);
    const result = await createJamendoAdapter({ clientId: "k", fetchImpl }).search({ limit: 2 });
    expect(result.tracks.map((t) => t.id)).toEqual(["jamendo:1", "jamendo:4"]);
    expect(result.skipped).toEqual({ invalid: 1, license: 1 }); // track 5 was never reached
  });

  it("keeps a repeated track once", async () => {
    const { fetchImpl } = serve([raw({ id: "1" }), raw({ id: "1" }), raw({ id: "2" })]);
    const result = await createJamendoAdapter({ clientId: "k", fetchImpl }).search({ limit: 5 });
    expect(result.tracks.map((t) => t.id)).toEqual(["jamendo:1", "jamendo:2"]);
  });

  it("turns a network failure into an error that does not carry the key", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed for https://api.jamendo.com/v3.0/tracks/?client_id=secret-key");
    });
    const adapter = createJamendoAdapter({ clientId: "secret-key", fetchImpl: fetchImpl as unknown as typeof fetch });
    const error = await adapter.search({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CatalogSourceError);
    expect(String((error as Error).message)).not.toContain("secret-key");
  });

  it("turns an HTTP error and a non-JSON body into source errors", async () => {
    const down = createJamendoAdapter({ clientId: "k", fetchImpl: (async () => ok({}, 503)) as unknown as typeof fetch });
    await expect(down.search({})).rejects.toThrow(/HTTP 503/);
    const html = createJamendoAdapter({ clientId: "k", fetchImpl: (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch });
    await expect(html.search({})).rejects.toThrow(/not JSON/);
  });

  it("passes Jamendo's refusal of the key through without the key", async () => {
    const body = { headers: { status: "failed", code: 5, error_message: "Invalid client_id" }, results: [] };
    const adapter = createJamendoAdapter({ clientId: "secret-key", fetchImpl: (async () => ok(body)) as unknown as typeof fetch });
    const error = await adapter.search({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CatalogSourceError);
    expect(String((error as Error).message)).not.toContain("secret-key");
  });

  it("fails the whole search when a later fetch fails, rather than returning a silently short page", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1 ? ok(page(catalog(15, 10))) : ok({}, 500);
    }) as unknown as typeof fetch;
    await expect(createJamendoAdapter({ clientId: "k", fetchImpl }).search({ limit: 5 })).rejects.toThrow(/HTTP 500/);
  });

  it("honours a share-alike opt-in from the policy", async () => {
    const sa = raw({ id: "9", license_ccurl: "https://creativecommons.org/licenses/by-sa/4.0/" });
    const { fetchImpl } = serve([sa]);
    expect((await createJamendoAdapter({ clientId: "k", fetchImpl }).search({})).tracks).toHaveLength(0);
    expect((await createJamendoAdapter({ clientId: "k", fetchImpl, policy: { allowShareAlike: true } }).search({})).tracks).toHaveLength(1);
  });
});

describe("attributionFor", () => {
  it("credits the creator, the source and the license, and notes the adaptation, which CC BY asks to be indicated", () => {
    const parsed = parseJamendoTrack(raw());
    if (!("track" in parsed)) throw new Error("fixture should parse");
    const attribution = attributionFor(parsed.track);
    expect(attribution.text).toBe(`“Neon Tide” by Kite Runner, via Jamendo. CC BY 4.0. ${ADAPTATION_NOTE}`);
    expect(attribution.adaptationNote).toBe(ADAPTATION_NOTE);
    expect(attribution.licenseUrl).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect(attribution.pageUrl).toBe("https://www.jamendo.com/track/1234567");
    expect(attribution.required).toBe(true);
  });

  it("asks for no credit or change notice for a public-domain dedication", () => {
    const parsed = parseJamendoTrack(raw({ license_ccurl: "https://creativecommons.org/publicdomain/zero/1.0/" }));
    if (!("track" in parsed)) throw new Error("fixture should parse");
    const attribution = attributionFor(parsed.track);
    expect(attribution.required).toBe(false);
    expect(attribution.adaptationNote).toBeUndefined();
    expect(attribution.text).toBe("“Neon Tide” by Kite Runner, via Jamendo. CC0 1.0.");
  });
});
