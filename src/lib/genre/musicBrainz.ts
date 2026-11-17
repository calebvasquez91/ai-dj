/**
 * MusicBrainzProvider: looks the recording up in MusicBrainz and reads its genres and tags (and its artist's), then collapses
 * them onto the taxonomy. Free, open data, so it follows their rules: a User-Agent that says who is calling, no more than one
 * request a second (the shared RateLimiter queues callers), and every answer cached (http.ts).
 *
 * Confidence from MusicBrainz's vote counts: a recording's own genre starts at 0.4 and gains 0.1 per vote, up to 0.7; a
 * genre only the artist has is weaker (0.3 plus 0.05 per vote, up to 0.55), because an artist can span several.
 */
import { normalizeMany, type GenreNode } from "@/lib/genres";
import type { GenreTag } from "@/types/music";
import { cachedJsonGet, HttpError } from "@/lib/genre/http";
import { isUnknownArtist, cleanTitle, primaryArtist, sameName } from "@/lib/genre/names";
import { EMPTY_RESULT, type Fetcher, type GenreProvider, type ProviderCacheStore, type ProviderInput, type ProviderResult, type RateLimiter } from "@/lib/genre/types";

const MB = "https://musicbrainz.org/ws/2";

interface MbNamed {
  name: string;
  count?: number;
}
interface MbRecording {
  id: string;
  title?: string;
  "first-release-date"?: string;
  score?: number;
  genres?: MbNamed[];
  tags?: MbNamed[];
  "artist-credit"?: { name?: string; artist?: { id: string; name?: string } }[];
}
interface MbSearch {
  recordings?: MbRecording[];
}
interface MbArtist {
  genres?: MbNamed[];
  tags?: MbNamed[];
}

export interface MusicBrainzOptions {
  fetcher: Fetcher;
  cache: ProviderCacheStore;
  limiter: RateLimiter;
  /** e.g. "QueDJ/2.0 ( https://example.com )": MusicBrainz asks every client to say who it is and how to reach them. */
  userAgent: string;
  now?: () => number;
}

/** The year in a MusicBrainz date ("1971-11-05", "1971"), or null. */
export function yearOfDate(date: string | undefined): number | null {
  const m = /^(\d{4})/.exec(date ?? "");
  const year = m ? Number(m[1]) : null;
  return year != null && year >= 1900 && year <= 2100 ? year : null;
}

const luceneEscape = (s: string) => s.replace(/(["\\])/g, "\\$1");

export function recordingConfidence(votes: number | undefined): number {
  return Math.min(0.7, 0.4 + 0.1 * Math.max(1, votes ?? 1));
}
export function artistConfidence(votes: number | undefined): number {
  return Math.min(0.55, 0.3 + 0.05 * Math.max(1, votes ?? 1));
}

/** The nodes named by MusicBrainz genres and tags, each with the best confidence it was given. Names that are not genres (years, "seen live", moods) fall away. */
function collect(into: Map<string, { node: GenreNode; confidence: number }>, items: MbNamed[] | undefined, confidenceOf: (votes?: number) => number) {
  for (const item of items ?? []) {
    for (const node of normalizeMany(item.name)) {
      const id = `${node.genre}/${node.subgenre ?? ""}`;
      const confidence = confidenceOf(item.count);
      const have = into.get(id);
      if (!have || confidence > have.confidence) into.set(id, { node, confidence });
    }
  }
}

export function createMusicBrainzProvider({ fetcher, cache, limiter, userAgent, now = Date.now }: MusicBrainzOptions): GenreProvider {
  const get = <T>(path: string) =>
    cachedJsonGet<T>({ provider: "musicbrainz", url: `${MB}/${path}`, cacheKey: path, fetcher, cache, limiter, headers: { "User-Agent": userAgent } });

  async function findRecordingId(input: ProviderInput): Promise<string | null> {
    if (isUnknownArtist(input.artist)) return null;
    const title = cleanTitle(input.title);
    const artist = primaryArtist(input.artist);
    const query = `recording:"${luceneEscape(title)}" AND artist:"${luceneEscape(artist)}"`;
    const found = await get<MbSearch>(`recording?query=${encodeURIComponent(query)}&limit=5&fmt=json`);
    for (const r of found?.recordings ?? []) {
      if ((r.score ?? 0) < 90 || !r.title) continue;
      if (!sameName(r.title, title)) continue;
      const credited = (r["artist-credit"] ?? []).some((c) => sameName(c.artist?.name ?? c.name ?? "", artist));
      if (credited) return r.id;
    }
    return null;
  }

  return {
    id: "musicbrainz",
    async classify(input: ProviderInput): Promise<ProviderResult> {
      try {
        const mbid = input.recordingMbid ?? (await findRecordingId(input));
        if (!mbid) return { ...EMPTY_RESULT, note: "no matching recording in MusicBrainz" };
        const recording = await get<MbRecording>(`recording/${mbid}?inc=artists+genres+tags&fmt=json`);
        if (!recording) return { ...EMPTY_RESULT, meta: { recordingMbid: mbid }, note: "the recording is not in MusicBrainz" };
        const year = yearOfDate(recording["first-release-date"]);

        const found = new Map<string, { node: GenreNode; confidence: number }>();
        collect(found, recording.genres, recordingConfidence);
        collect(found, recording.tags, (v) => recordingConfidence(v) - 0.05);
        const artistId = recording["artist-credit"]?.[0]?.artist?.id;
        if (artistId) {
          const artist = await get<MbArtist>(`artist/${artistId}?inc=genres+tags&fmt=json`);
          collect(found, artist?.genres, artistConfidence);
          collect(found, artist?.tags, (v) => artistConfidence(v) - 0.05);
        }
        const at = now();
        const tags: GenreTag[] = [...found.values()]
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 6)
          .map(({ node, confidence }) => ({ genre: node.genre, ...(node.subgenre ? { subgenre: node.subgenre } : {}), source: "musicbrainz" as const, confidence, updatedAt: at }));
        return { tags, moods: [], meta: { recordingMbid: mbid, year }, note: tags.length === 0 ? "MusicBrainz has no genre for this recording" : undefined };
      } catch (err) {
        return { ...EMPTY_RESULT, note: err instanceof HttpError ? err.message : "MusicBrainz lookup failed" };
      }
    },
  };
}
