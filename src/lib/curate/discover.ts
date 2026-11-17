/**
 * Discover suggestions for a playlist the library cannot fill: artists similar to the ones that did match, from Last.fm.
 * These are metadata only (an artist's name and why it is suggested). A track must already be in the library before it can
 * go in a playlist; nothing here adds, fetches or links audio. Artists already in the library are left out. Cached and
 * rate-limited like every Last.fm call (src/lib/genre/http.ts). Server-only.
 */
import { aliasKey } from "@/lib/genres";
import { cachedJsonGet } from "@/lib/genre/http";
import type { Fetcher, ProviderCacheStore, RateLimiter } from "@/lib/genre/types";

const LASTFM = "https://ws.audioscrobbler.com/2.0/";

export interface DiscoverSuggestion {
  artist: string;
  /** "Similar to X, Y". */
  because: string;
  match: number;
}

interface LfmSimilar {
  similarartists?: { artist?: { name?: string; match?: string | number }[] | { name?: string; match?: string | number } };
  error?: number;
}

export interface DiscoverDeps {
  fetcher: Fetcher;
  cache: ProviderCacheStore;
  limiter: RateLimiter;
  userAgent: string;
  apiKey: () => string | undefined;
}

export async function similarArtists(artist: string, deps: DiscoverDeps): Promise<{ name: string; match: number }[]> {
  const key = deps.apiKey();
  if (!key) return [];
  try {
    const params = new URLSearchParams({ method: "artist.getsimilar", artist, autocorrect: "1", limit: "8", format: "json", api_key: key });
    const body = await cachedJsonGet<LfmSimilar>({
      provider: "lastfm",
      url: `${LASTFM}?${params.toString()}`,
      cacheKey: `artist.getsimilar:${aliasKey(artist)}`,
      fetcher: deps.fetcher,
      cache: deps.cache,
      limiter: deps.limiter,
      headers: { "User-Agent": deps.userAgent },
    });
    if (!body || body.error) return [];
    const raw = body.similarartists?.artist;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.filter((a) => a.name).map((a) => ({ name: String(a.name), match: Number(a.match) || 0 }));
  } catch {
    return [];
  }
}

/** Up to `limit` artists similar to `seeds`, not in `libraryArtists`, best match first, each with the seeds it is similar to. */
export async function discoverSuggestions(seeds: readonly string[], libraryArtists: readonly string[], deps: DiscoverDeps, limit = 6): Promise<DiscoverSuggestion[]> {
  const have = new Set(libraryArtists.map(aliasKey));
  const found = new Map<string, { artist: string; match: number; seeds: string[] }>();
  for (const seed of seeds.slice(0, 3)) {
    for (const s of await similarArtists(seed, deps)) {
      const k = aliasKey(s.name);
      if (!k || have.has(k)) continue;
      const entry = found.get(k) ?? { artist: s.name, match: 0, seeds: [] };
      entry.match = Math.max(entry.match, s.match);
      if (!entry.seeds.includes(seed)) entry.seeds.push(seed);
      found.set(k, entry);
    }
  }
  return [...found.values()]
    .sort((a, b) => b.seeds.length - a.seeds.length || b.match - a.match)
    .slice(0, limit)
    .map((e) => ({ artist: e.artist, because: `Similar to ${e.seeds.join(", ")}`, match: Math.round(e.match * 100) / 100 }));
}
