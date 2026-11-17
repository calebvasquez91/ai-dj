/**
 * LastFmProvider: the track's and the artist's top tags from Last.fm. Each tag is sorted three ways: a genre (collapsed onto
 * the taxonomy), a mood (kept separately, for Track.moods), or noise ("seen live", "female vocalists", a decade, a year) that
 * is thrown away. The key comes from the server's LASTFM_API_KEY; without it the provider just reports it is not configured.
 *
 * Last.fm gives each tag a 0-100 weight relative to the top one. A track's own tag is worth 0.35 plus 0.4 of that weight (up
 * to 0.75); a tag only the artist has is worth 0.3 plus 0.3 of it (up to 0.6). Calls are spaced at least 250 ms apart
 * (their limit is five a second) and every answer is cached.
 */
import { normalize, type GenreNode } from "@/lib/genres";
import { normalizeMood } from "@/lib/moodTags";
import type { GenreTag } from "@/types/music";
import { cachedJsonGet, HttpError } from "@/lib/genre/http";
import { cleanTitle, isUnknownArtist, primaryArtist } from "@/lib/genre/names";
import { aliasKey } from "@/lib/genres";
import { EMPTY_RESULT, type Fetcher, type GenreProvider, type ProviderCacheStore, type ProviderInput, type ProviderResult, type RateLimiter } from "@/lib/genre/types";

const LASTFM = "https://ws.audioscrobbler.com/2.0/";

interface LfmTag {
  name: string;
  count?: number | string;
}
interface LfmTopTags {
  toptags?: { tag?: LfmTag[] | LfmTag };
  /** Last.fm answers 200 with an error body, e.g. 6 = "Track not found". */
  error?: number;
  message?: string;
}

export interface LastFmOptions {
  fetcher: Fetcher;
  cache: ProviderCacheStore;
  limiter: RateLimiter;
  userAgent: string;
  /** Read at call time so a key added to the environment is picked up without a restart. */
  apiKey: () => string | undefined;
  now?: () => number;
}

/** The most moods kept for a track, and the weight a mood tag needs to count. */
export const MAX_MOODS = 5;
export const MOOD_MIN_WEIGHT = 20;

export const trackTagConfidence = (weight: number) => Math.min(0.75, 0.35 + 0.4 * (weight / 100));
export const artistTagConfidence = (weight: number) => Math.min(0.6, 0.3 + 0.3 * (weight / 100));

function tagList(body: LfmTopTags | null): { name: string; weight: number }[] {
  if (!body || body.error) return [];
  const raw = body.toptags?.tag;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map((t) => ({ name: String(t.name ?? ""), weight: Math.max(0, Math.min(100, Number(t.count) || 0)) }))
    .filter((t) => t.name !== "");
}

export function createLastFmProvider({ fetcher, cache, limiter, userAgent, apiKey, now = Date.now }: LastFmOptions): GenreProvider {
  async function topTags(method: "track.gettoptags" | "artist.gettoptags", artist: string, track: string | null) {
    const key = apiKey();
    const params = new URLSearchParams({ method, artist, autocorrect: "1", format: "json" });
    if (track != null) params.set("track", track);
    // The cache key is the lookup without the API key, so the key never reaches the cache.
    const cacheKey = `${method}:${aliasKey(artist)}:${track != null ? aliasKey(track) : ""}`;
    params.set("api_key", key ?? "");
    return cachedJsonGet<LfmTopTags>({ provider: "lastfm", url: `${LASTFM}?${params.toString()}`, cacheKey, fetcher, cache, limiter, headers: { "User-Agent": userAgent } });
  }

  return {
    id: "lastfm",
    async classify(input: ProviderInput): Promise<ProviderResult> {
      if (!apiKey()) return { ...EMPTY_RESULT, note: "LASTFM_API_KEY is not set" };
      if (isUnknownArtist(input.artist)) return { ...EMPTY_RESULT, note: "no artist to look up" };
      const artist = primaryArtist(input.artist);
      const title = cleanTitle(input.title);
      try {
        const [trackBody, artistBody] = await Promise.all([topTags("track.gettoptags", artist, title), topTags("artist.gettoptags", artist, null)]);
        const genres = new Map<string, { node: GenreNode; confidence: number }>();
        const moods = new Map<string, number>();
        const take = (list: { name: string; weight: number }[], confidenceOf: (weight: number) => number) => {
          for (const { name, weight } of list) {
            const node = normalize(name);
            if (node) {
              const id = `${node.genre}/${node.subgenre ?? ""}`;
              const confidence = confidenceOf(weight);
              const have = genres.get(id);
              if (!have || confidence > have.confidence) genres.set(id, { node, confidence });
              continue;
            }
            const mood = normalizeMood(name);
            if (mood && weight >= MOOD_MIN_WEIGHT) moods.set(mood, Math.max(moods.get(mood) ?? 0, weight));
          }
        };
        take(tagList(trackBody), trackTagConfidence);
        take(tagList(artistBody), artistTagConfidence);
        const at = now();
        const tags: GenreTag[] = [...genres.values()]
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 6)
          .map(({ node, confidence }) => ({ genre: node.genre, ...(node.subgenre ? { subgenre: node.subgenre } : {}), source: "lastfm" as const, confidence, updatedAt: at }));
        const moodList = [...moods.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_MOODS).map(([m]) => m);
        return { tags, moods: moodList, note: tags.length === 0 && moodList.length === 0 ? "Last.fm has no usable tags for this track" : undefined };
      } catch (err) {
        return { ...EMPTY_RESULT, note: err instanceof HttpError ? err.message : "Last.fm lookup failed" };
      }
    },
  };
}
