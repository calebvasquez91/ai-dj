/**
 * A small per-account rate limit for routes that cost money or write rows (the Haiku pick, the decision log). Pure: the clock is injected. It keeps its counts
 * in memory, so on a serverless host each warm instance counts separately: a brake on a runaway loop or a hostile script, not an exact quota.
 */
export interface UserRateLimiter {
  /** True when this account may make a call now (and counts it); false when it has used up its calls in the window. */
  allow(key: string, now?: number): boolean;
}

export function createUserRateLimiter(opts: { max: number; windowMs: number; maxKeys?: number }): UserRateLimiter {
  const hits = new Map<string, number[]>();
  const maxKeys = opts.maxKeys ?? 5000;
  return {
    allow(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      // forget accounts that have gone quiet, so the map cannot grow without limit
      if (hits.size > maxKeys) for (const [k, v] of hits) if (v.every((t) => now - t >= opts.windowMs)) hits.delete(k);
      return true;
    },
  };
}
