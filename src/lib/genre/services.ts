/**
 * The small services the providers share, in memory: a response cache and a rate limiter. Tests use these as they are; the
 * server swaps in the database-backed versions (prismaServices.ts) so the cache and the limit hold across serverless instances.
 */
import type { ProviderCacheStore, RateLimiter } from "@/lib/genre/types";

export function memoryCache(now: () => number = Date.now): ProviderCacheStore & { size(): number } {
  const entries = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    async get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return hit.value;
    },
    async set(key, _provider, value, ttlMs) {
      entries.set(key, { value, expiresAt: now() + ttlMs });
    },
    size: () => entries.size,
  };
}

/** Where a limiter records the last request to each provider. `claim` is atomic: of callers that arrive together, only one gets 0. */
export interface RateStore {
  /** 0 when the caller now holds the next slot; otherwise how many ms until a slot may be free (try again then). */
  claim(provider: string, minIntervalMs: number): Promise<number>;
}

export function memoryRateStore(now: () => number = Date.now): RateStore {
  const last = new Map<string, number>();
  return {
    async claim(provider, minIntervalMs) {
      const at = now();
      const before = last.get(provider);
      if (before == null || at - before >= minIntervalMs) {
        last.set(provider, at);
        return 0;
      }
      return minIntervalMs - (at - before);
    },
  };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The longest one acquire() will wait for a slot before giving up, so a stuck store cannot hang a job. */
export const RATE_WAIT_LIMIT_MS = 60_000;

/**
 * A limiter for providers that allow at most one request per `minIntervalMs[provider]`. A provider with no interval is not
 * limited. Callers queue: each waits for its own slot, so a burst of lookups is spread out instead of rejected.
 */
export function createRateLimiter(
  minIntervalMs: Readonly<Record<string, number>>,
  store: RateStore,
  sleep: (ms: number) => Promise<void> = defaultSleep
): RateLimiter {
  return {
    async acquire(provider) {
      const interval = minIntervalMs[provider];
      if (!interval || interval <= 0) return;
      let waited = 0;
      for (;;) {
        const wait = await store.claim(provider, interval);
        if (wait <= 0) return;
        if (waited + wait > RATE_WAIT_LIMIT_MS) throw new Error(`Rate limit wait for ${provider} is too long.`);
        // A little jitter keeps callers that woke together from claiming the same instant again.
        const pause = Math.ceil(wait) + Math.floor(Math.random() * 20);
        waited += pause;
        await sleep(pause);
      }
    },
  };
}

/** The minimum gap between requests to each provider, from the services' own published limits (MusicBrainz: 1 per second). */
export const PROVIDER_MIN_INTERVAL_MS: Readonly<Record<string, number>> = {
  musicbrainz: 1100,
  lastfm: 250,
  acoustid: 340,
};
