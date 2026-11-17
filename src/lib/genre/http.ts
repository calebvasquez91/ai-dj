/**
 * One cached, rate-limited JSON GET for the providers that call a web service (MusicBrainz, Last.fm, AcoustID). The cache is
 * checked first (a hit costs no request and no rate-limit slot); a miss waits for the provider's slot, sends the request
 * with the app's identity, and keeps the answer, including "not found", so the same lookup is never paid for twice.
 */
import { CACHE_TTL_MS, NEGATIVE_CACHE_TTL_MS, type Fetcher, type ProviderCacheStore, type RateLimiter } from "@/lib/genre/types";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export interface JsonGetOptions {
  provider: string;
  /** What to call. May hold a secret (an API key): it is never cached or logged. */
  url: string;
  /** What identifies this lookup in the cache. Must not hold a secret. */
  cacheKey: string;
  fetcher: Fetcher;
  cache: ProviderCacheStore;
  limiter: RateLimiter;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** POST a body instead (AcoustID wants the long fingerprint in the body, not the URL). */
  body?: string;
}

const NOT_FOUND = { __notFound: true } as const;

/** The answer, or null when the service says it has nothing (404). Throws HttpError for any other failure (nothing is cached for those). */
export async function cachedJsonGet<T>(opts: JsonGetOptions): Promise<T | null> {
  const key = `${opts.provider}:${opts.cacheKey}`;
  const hit = await opts.cache.get(key);
  if (hit !== undefined) return (hit as { __notFound?: boolean }).__notFound ? null : (hit as T);

  await opts.limiter.acquire(opts.provider);
  let res: Response;
  try {
    res = await opts.fetcher(opts.url, {
      ...(opts.body != null ? { method: "POST", body: opts.body } : {}),
      headers: { Accept: "application/json", ...opts.headers },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
  } catch (err) {
    // Never put the URL (it can hold an API key) in the message.
    throw new HttpError(0, `${opts.provider} request failed: ${err instanceof Error ? err.name : "error"}`);
  }
  if (res.status === 404) {
    await opts.cache.set(key, opts.provider, NOT_FOUND, NEGATIVE_CACHE_TTL_MS);
    return null;
  }
  if (!res.ok) throw new HttpError(res.status, `${opts.provider} answered ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new HttpError(res.status, `${opts.provider} sent something that was not JSON`);
  }
  await opts.cache.set(key, opts.provider, body, CACHE_TTL_MS);
  return body as T;
}
