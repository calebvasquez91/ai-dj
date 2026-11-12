import { describe, expect, it, vi } from "vitest";
import { attributionFor } from "@/lib/catalog/attribution";
import {
  buildJamendoSearchUrl,
  createJamendoAdapter,
  JAMENDO_MAX_LIMIT,
  parseJamendoResponse,
  parseJamendoTrack,
} from "@/lib/catalog/jamendo";
import { CatalogSourceError } from "@/lib/catalog/types";

const CC_BY = "https://creativecommons.org/licenses/by/4.0/";

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
    const parsed = parseJamendoTrack(raw({ artist_name: " ", album_name: "", image: "", album_image: "http://x.test/a.jpg", shareurl: "javascript:alert(1)" }));
    expect("track" in parsed).toBe(true);
    if (!("track" in parsed)) return;
    expect(parsed.track.artist).toBe("Unknown Artist");
    expect(parsed.track.album).toBeUndefined();
    expect(parsed.track.imageUrl).toBeUndefined();
    expect(parsed.track.pageUrl).toBeUndefined();
  });

  it("skips what can't be played", () => {
    for (const bad of [
      { id: "" },
      { id: undefined },
      { name: " " },
      { audio: "" },
      { audio: "http://prod-1.storage.jamendo.com/?trackid=1" },
      { audio: "javascript:alert(1)" },
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

describe("parseJamendoResponse", () => {
  it("returns the usable tracks, counts what it left out, and points at the next page", () => {
    const results = [
      raw({ id: "1" }),
      raw({ id: "2", license_ccurl: "https://creativecommons.org/licenses/by-nc/3.0/" }),
      raw({ id: "3", audio: "" }),
      raw({ id: "4", license_ccurl: "https://creativecommons.org/publicdomain/zero/1.0/" }),
    ];
    const result = parseJamendoResponse(page(results), { limit: 4, offset: 8 });
    expect(result.tracks.map((t) => t.id)).toEqual(["jamendo:1", "jamendo:4"]);
    expect(result.skipped).toEqual({ invalid: 1, license: 1 });
    expect(result.offset).toBe(8);
    // Four were sent for a limit of four: there may be more, counted from what was sent, not what was kept.
    expect(result.nextOffset).toBe(12);
  });

  it("ends the paging on a short page", () => {
    const result = parseJamendoResponse(page([raw({ id: "1" })]), { limit: 20 });
    expect(result.nextOffset).toBeNull();
  });

  it("keeps a repeated track once", () => {
    const result = parseJamendoResponse(page([raw({ id: "1" }), raw({ id: "1" })]), { limit: 20 });
    expect(result.tracks).toHaveLength(1);
  });

  it("throws on a failure Jamendo reports with HTTP 200, and on a body that is not a result list", () => {
    const failed = { headers: { status: "failed", code: 5, error_message: "Invalid client_id" }, results: [] };
    expect(() => parseJamendoResponse(failed, {})).toThrow(CatalogSourceError);
    expect(() => parseJamendoResponse(failed, {})).toThrow(/Invalid client_id/);
    expect(() => parseJamendoResponse({}, {})).toThrow(CatalogSourceError);
    expect(() => parseJamendoResponse(null, {})).toThrow(CatalogSourceError);
    expect(() => parseJamendoResponse({ results: "nope" }, {})).toThrow(CatalogSourceError);
  });

  it("copes with a null entry in the results", () => {
    const result = parseJamendoResponse(page([null, raw({ id: "1" })]), {});
    expect(result.tracks).toHaveLength(1);
    expect(result.skipped.invalid).toBe(1);
  });
});

describe("createJamendoAdapter", () => {
  it("searches with the key and returns only usable tracks", async () => {
    const fetchImpl = vi.fn(async () => ok(page([raw({ id: "1" }), raw({ id: "2", license_ccurl: "https://creativecommons.org/licenses/by-nd/4.0/" })])));
    const adapter = createJamendoAdapter({ clientId: "secret-key", fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await adapter.search({ text: "house" });
    expect(adapter.id).toBe("jamendo");
    expect(result.tracks.map((t) => t.id)).toEqual(["jamendo:1"]);
    expect(result.skipped.license).toBe(1);
    const calledWith = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(calledWith).toContain("client_id=secret-key");
    expect(calledWith).toContain("search=house");
  });

  it("refuses to be built without a client id", () => {
    expect(() => createJamendoAdapter({ clientId: "  " })).toThrow(CatalogSourceError);
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

  it("honours a share-alike opt-in from the policy", async () => {
    const sa = raw({ id: "9", license_ccurl: "https://creativecommons.org/licenses/by-sa/4.0/" });
    const fetchImpl = (async () => ok(page([sa]))) as unknown as typeof fetch;
    expect((await createJamendoAdapter({ clientId: "k", fetchImpl }).search({})).tracks).toHaveLength(0);
    expect((await createJamendoAdapter({ clientId: "k", fetchImpl, policy: { allowShareAlike: true } }).search({})).tracks).toHaveLength(1);
  });
});

describe("attributionFor", () => {
  it("credits the creator, the source and the license, and says credit is required for CC BY", () => {
    const parsed = parseJamendoTrack(raw());
    if (!("track" in parsed)) throw new Error("fixture should parse");
    const attribution = attributionFor(parsed.track);
    expect(attribution.text).toBe("“Neon Tide” by Kite Runner, via Jamendo. CC BY 4.0.");
    expect(attribution.licenseUrl).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect(attribution.pageUrl).toBe("https://www.jamendo.com/track/1234567");
    expect(attribution.required).toBe(true);
  });

  it("marks credit as courtesy for a public-domain dedication", () => {
    const parsed = parseJamendoTrack(raw({ license_ccurl: "https://creativecommons.org/publicdomain/zero/1.0/" }));
    if (!("track" in parsed)) throw new Error("fixture should parse");
    expect(attributionFor(parsed.track).required).toBe(false);
  });
});
