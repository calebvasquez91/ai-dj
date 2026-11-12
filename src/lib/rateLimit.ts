/**
 * A small sliding-window limiter, kept in memory. It is per server instance (a serverless deployment may run several),
 * so it is a guard against a client loop or rapid skipping running up Anthropic calls, not a hard quota.
 */

export interface RateLimiter {
  /** Records a request for `key` and returns true, or returns false (recording nothing) when `key` already made `max` requests within the window. */
  take(key: string, nowMs?: number): boolean;
}

/** Keys remembered at most; the oldest-seen are forgotten first, so the map cannot grow without bound. */
const MAX_KEYS = 5000;

export function createRateLimiter({ max, windowMs }: { max: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    take(key, nowMs = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => nowMs - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(nowMs);
      // Re-insert so the most recently active key is the newest in the map's order.
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > MAX_KEYS) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
      return true;
    },
  };
}
