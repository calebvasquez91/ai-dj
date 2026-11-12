import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rateLimit";

describe("createRateLimiter", () => {
  it("allows up to max requests in the window, then refuses", () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 1000 });
    expect([0, 100, 200].map((t) => limiter.take("a", t))).toEqual([true, true, true]);
    expect(limiter.take("a", 300)).toBe(false);
    expect(limiter.take("a", 301)).toBe(false);
  });

  it("lets requests through again as old ones leave the window", () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 1000 });
    limiter.take("a", 0);
    limiter.take("a", 500);
    expect(limiter.take("a", 900)).toBe(false);
    expect(limiter.take("a", 1001)).toBe(true); // the one at 0 has expired
    expect(limiter.take("a", 1100)).toBe(false); // 500 and 1001 are still in the window
  });

  it("does not count a refused request against the key", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
    limiter.take("a", 0);
    for (let t = 100; t < 900; t += 100) expect(limiter.take("a", t)).toBe(false);
    expect(limiter.take("a", 1001)).toBe(true);
  });

  it("keeps each key's count separate", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.take("a", 0)).toBe(true);
    expect(limiter.take("b", 0)).toBe(true);
    expect(limiter.take("a", 10)).toBe(false);
  });

  it("forgets the oldest keys rather than growing without bound", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000_000 });
    for (let i = 0; i < 5100; i++) limiter.take(`user${i}`, i);
    // user0 was forgotten, so it is treated as new; a recent key is still limited.
    expect(limiter.take("user0", 5200)).toBe(true);
    expect(limiter.take("user5099", 5200)).toBe(false);
  });
});
