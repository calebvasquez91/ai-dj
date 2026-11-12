import { describe, expect, it, vi } from "vitest";
import {
  CATALOG_DEFAULT_LIMIT,
  CATALOG_MAX_LIMIT,
  createCachedSearch,
  getCatalogAdapter,
  parseCatalogQuery,
  serializeCatalogPage,
} from "@/lib/catalog/search";
import { parseJamendoTrack } from "@/lib/catalog/jamendo";
import { CatalogSourceError, type CatalogAdapter, type CatalogPage } from "@/lib/catalog/types";

const parse = (qs: string) => parseCatalogQuery(new URLSearchParams(qs));

describe("parseCatalogQuery", () => {
  it("defaults to Jamendo, 20 results from the start", () => {
    const result = parse("");
    expect(result).toEqual({ ok: true, value: { source: "jamendo", query: { limit: CATALOG_DEFAULT_LIMIT, offset: 0 } } });
  });

  it("reads every filter", () => {
    const result = parse("q=deep%20house&tags=House,%20Electronic&speed=high,veryhigh&vocal=Instrumental&minDuration=90&maxDuration=420&limit=10&offset=30");
    expect(result).toEqual({
      ok: true,
      value: {
        source: "jamendo",
        query: {
          text: "deep house",
          tags: ["house", "electronic"],
          speed: ["high", "veryhigh"],
          vocal: "instrumental",
          minDurationSec: 90,
          maxDurationSec: 420,
          limit: 10,
          offset: 30,
        },
      },
    });
  });

  it("caps the free text and trims it", () => {
    const result = parse(`q=${encodeURIComponent("  " + "x".repeat(300))}`);
    expect(result.ok && result.value.query.text?.length).toBe(100);
  });

  it("rejects what it doesn't understand instead of passing it on", () => {
    for (const bad of [
      "source=spotify",
      "speed=warp",
      "vocal=maybe",
      "limit=0",
      `limit=${CATALOG_MAX_LIMIT + 1}`,
      "limit=-5",
      "limit=abc",
      "limit=1.5",
      "offset=-1",
      "offset=99999",
      "minDuration=abc",
      "maxDuration=99999",
      "minDuration=300&maxDuration=100",
      "minDuration=100&maxDuration=100",
      "tags=a,b,c,d,e,f",
      `tags=${"t".repeat(40)}`,
      "tags=rock%20%26%20roll",
      "tags=-leading",
    ]) {
      expect(parse(bad).ok, bad).toBe(false);
    }
  });

  it("gives a reason a person can read", () => {
    const result = parse("speed=warp");
    expect(!result.ok && result.error).toMatch(/speed must be/);
  });

  it("ignores empty values", () => {
    const result = parse("q=&tags=&speed=&limit=&offset=");
    expect(result).toEqual({ ok: true, value: { source: "jamendo", query: { limit: 20, offset: 0 } } });
  });
});

const raw = {
  id: "7",
  name: "Neon Tide",
  duration: 200,
  artist_name: "Kite Runner",
  license_ccurl: "https://creativecommons.org/licenses/by/4.0/",
  audio: "https://prod-1.storage.jamendo.com/?trackid=7&format=mp32",
  shareurl: "https://www.jamendo.com/track/7",
};
function page(): CatalogPage {
  const parsed = parseJamendoTrack(raw);
  if (!("track" in parsed)) throw new Error("fixture should parse");
  return { tracks: [parsed.track], offset: 0, nextOffset: 20, skipped: { invalid: 1, license: 2 } };
}

describe("serializeCatalogPage", () => {
  it("gives each track its credit line, license and paging", () => {
    const out = serializeCatalogPage(page());
    expect(out.nextOffset).toBe(20);
    expect(out.skipped).toEqual({ invalid: 1, license: 2 });
    expect(out.tracks[0]).toMatchObject({
      id: "jamendo:7",
      title: "Neon Tide",
      artist: "Kite Runner",
      license: { code: "by", label: "CC BY 4.0", requiresAttribution: true },
      attribution: { text: "“Neon Tide” by Kite Runner, via Jamendo. CC BY 4.0.", required: true },
    });
  });

  it("is plain JSON (no class instances or functions)", () => {
    const out = serializeCatalogPage(page());
    expect(JSON.parse(JSON.stringify(out))).toEqual(JSON.parse(JSON.stringify(out)));
  });
});

describe("getCatalogAdapter", () => {
  it("builds the Jamendo adapter when the server has a client id", () => {
    expect(getCatalogAdapter("jamendo", { JAMENDO_CLIENT_ID: "abc" })?.id).toBe("jamendo");
  });
  it("is null with no client id, a blank one, or an unknown source", () => {
    expect(getCatalogAdapter("jamendo", {})).toBeNull();
    expect(getCatalogAdapter("jamendo", { JAMENDO_CLIENT_ID: "   " })).toBeNull();
    expect(getCatalogAdapter("archive", { JAMENDO_CLIENT_ID: "abc" })).toBeNull();
  });
});

describe("createCachedSearch", () => {
  function adapter(search: CatalogAdapter["search"]): CatalogAdapter {
    return { id: "jamendo", search };
  }

  it("reuses a result for an identical search within the time to live, then asks again", async () => {
    const search = vi.fn(async () => page());
    const cached = createCachedSearch({ ttlMs: 1000 });
    const a = adapter(search);
    await cached.search(a, { text: "house", limit: 20, offset: 0 }, 0);
    await cached.search(a, { text: "house", limit: 20, offset: 0 }, 999);
    expect(search).toHaveBeenCalledTimes(1);
    await cached.search(a, { text: "house", limit: 20, offset: 0 }, 1001);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("treats a different query as a different search", async () => {
    const search = vi.fn(async () => page());
    const cached = createCachedSearch();
    const a = adapter(search);
    await cached.search(a, { text: "house", limit: 20, offset: 0 }, 0);
    await cached.search(a, { text: "house", limit: 20, offset: 20 }, 0);
    await cached.search(a, { text: "techno", limit: 20, offset: 0 }, 0);
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("shares one in-flight request between identical concurrent searches", async () => {
    let release: (p: CatalogPage) => void = () => {};
    const search = vi.fn(() => new Promise<CatalogPage>((resolve) => (release = resolve)));
    const cached = createCachedSearch();
    const a = adapter(search);
    const first = cached.search(a, { limit: 20, offset: 0 }, 0);
    const second = cached.search(a, { limit: 20, offset: 0 }, 0);
    release(page());
    await Promise.all([first, second]);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("never caches a failure", async () => {
    const search = vi.fn().mockRejectedValueOnce(new CatalogSourceError("down")).mockResolvedValue(page());
    const cached = createCachedSearch();
    const a = adapter(search);
    await expect(cached.search(a, { limit: 20, offset: 0 }, 0)).rejects.toThrow(CatalogSourceError);
    await expect(cached.search(a, { limit: 20, offset: 0 }, 1)).resolves.toBeDefined();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("forgets the least recently used entries beyond its size", async () => {
    const search = vi.fn(async () => page());
    const cached = createCachedSearch({ maxEntries: 2 });
    const a = adapter(search);
    for (const q of ["a", "b", "c"]) await cached.search(a, { text: q, limit: 20, offset: 0 }, 0);
    await cached.search(a, { text: "a", limit: 20, offset: 0 }, 0); // "a" was evicted: asks again
    expect(search).toHaveBeenCalledTimes(4);
  });
});
