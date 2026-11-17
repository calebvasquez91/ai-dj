/**
 * The shared shapes of genre classification: what a provider is given, what it gives back, and the small services the
 * providers lean on (a cache, a rate limiter, an HTTP client), each behind an interface so tests can run them with fakes and
 * the server can back them with the database.
 */
import type { GenreTag, GenreTagSource } from "@/types/music";

/** What a provider is told about a track. Everything past the first four is a best guess carried forward by earlier providers. */
export interface ProviderInput {
  trackId: string;
  title: string;
  artist: string;
  durationSec: number;
  source: "local" | "youtube";
  /** Where the audio file is stored (a local id, or a blob URL); absent for a YouTube track, which has no file. */
  storageKey?: string;
  mimeType?: string;
  /** Found by an earlier provider (the file's tags, or a fingerprint match). */
  album?: string | null;
  year?: number | null;
  recordingMbid?: string | null;
  /** What the other sources said, for the LLM reconciler (the only provider that reads it). */
  evidence?: SourceEvidence[];
}

/** One source's answer, as the reconciler is shown it. */
export interface SourceEvidence {
  source: GenreTagSource;
  tags: GenreTag[];
  moods?: string[];
}

/** What a provider found out. `tags` are genre tags already on the taxonomy; `moods` are canonical mood ids. */
export interface ProviderResult {
  tags: GenreTag[];
  moods: string[];
  /** Facts about the track the next providers can use: the album and year the file's tags give, a MusicBrainz recording id. */
  meta?: { album?: string | null; year?: number | null; recordingMbid?: string | null };
  /** Why a provider that found nothing found nothing ("no tags in the file", "not configured"), for the log. */
  note?: string;
}

export const EMPTY_RESULT: ProviderResult = { tags: [], moods: [] };

/**
 * One source of genre tags. classify() never throws: a failed lookup is an empty result with a `note`, because one
 * source being down must not stop the others. (It returns the tags plus the moods and facts the source learned, not
 * a bare GenreTag[], because the Last.fm moods and a fingerprint's recording id have nowhere else to go.)
 */
export interface GenreProvider {
  readonly id: GenreTagSource;
  classify(input: ProviderInput): Promise<ProviderResult>;
}

/** A key-value store with expiry, for provider responses. */
export interface ProviderCacheStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, provider: string, value: unknown, ttlMs: number): Promise<void>;
}

/** Holds callers back so a provider is never called faster than its allowed rate, across every instance that shares the store. */
export interface RateLimiter {
  /** Resolves when the caller may make one request to `provider`. */
  acquire(provider: string): Promise<void>;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** The request headers every provider sends so the services can tell who is calling. */
export interface Identity {
  userAgent: string;
}

/** The days a cached answer is kept: a recording's genres hardly change, and an empty answer is retried sooner. */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const NEGATIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
