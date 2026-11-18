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

/** A failure that may pass on its own: the service was unreachable (status 0), rate limited, or erroring on its side. */
export function isTransient(err: unknown): boolean {
  return err instanceof HttpError && (err.status === 0 || err.status === 429 || err.status >= 500);
}

/** How many times a busy service (MusicBrainz answers 503 "busy" under load) is tried again inside one lookup, and how long to wait before each. */
export const RETRY_DELAYS_MS = [2000, 5000];
const MAX_RETRY_AFTER_MS = 8000;

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
  /** Looks at an answer that came back with a success status and says whether it is really an error (Last.fm sends its rate limit and outages as HTTP 200 with an error code). A `notFound` one is kept as "nothing here"; any other is thrown as an HttpError with that status and is never cached. */
  errorBody?: (body: unknown) => { status: number; notFound?: boolean } | null;
  /** POST a body instead (AcoustID wants the long fingerprint in the body, not the URL). */
  body?: string;
  /** For tests: replaces the real wait between tries. */
  sleep?: (ms: number) => Promise<void>;
}

const NOT_FOUND = { __notFound: true } as const;

/** The answer, or null when the service says it has nothing (404). Throws HttpError for any other failure (nothing is cached for those). */
export async function cachedJsonGet<T>(opts: JsonGetOptions): Promise<T | null> {
  const key = `${opts.provider}:${opts.cacheKey}`;
  const hit = await opts.cache.get(key);
  if (hit !== undefined) return (hit as { __notFound?: boolean }).__notFound ? null : (hit as T);

  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let res: Response | null = null;
  for (let attempt = 0; ; attempt++) {
    // Each try waits for its own rate-limit slot: a retry is a request like any other.
    await opts.limiter.acquire(opts.provider);
    try {
      res = await opts.fetcher(opts.url, {
        ...(opts.body != null ? { method: "POST", body: opts.body } : {}),
        headers: { Accept: "application/json", ...opts.headers },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
    } catch (err) {
      res = null;
      // Never put the URL (it can hold an API key) in the message.
      if (attempt >= RETRY_DELAYS_MS.length) throw new HttpError(0, `${opts.provider} request failed: ${err instanceof Error ? err.name : "error"}`);
    }
    if (res && res.status !== 429 && res.status < 500) break;
    if (attempt >= RETRY_DELAYS_MS.length) break;
    const asked = Number(res?.headers.get("retry-after")) * 1000;
    await sleep(Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_RETRY_AFTER_MS) : RETRY_DELAYS_MS[attempt]);
  }
  if (!res) throw new HttpError(0, `${opts.provider} request failed`);
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
  const bad = opts.errorBody?.(body);
  if (bad) {
    if (bad.notFound) {
      await opts.cache.set(key, opts.provider, NOT_FOUND, NEGATIVE_CACHE_TTL_MS);
      return null;
    }
    throw new HttpError(bad.status, `${opts.provider} reported an error (${bad.status})`);
  }
  await opts.cache.set(key, opts.provider, body, CACHE_TTL_MS);
  return body as T;
}
