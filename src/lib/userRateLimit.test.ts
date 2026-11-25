import { describe, expect, it } from "vitest";
import { createUserRateLimiter } from "./userRateLimit";

describe("createUserRateLimiter", () => {
  it("allows up to max calls per window per account, then refuses until the window moves on", () => {
    const l = createUserRateLimiter({ max: 3, windowMs: 1000 });
    expect([l.allow("a", 0), l.allow("a", 100), l.allow("a", 200), l.allow("a", 300)]).toEqual([true, true, true, false]);
    expect(l.allow("a", 999)).toBe(false);
    expect(l.allow("a", 1001)).toBe(true); // the first call has aged out
  });

  it("counts each account on its own", () => {
    const l = createUserRateLimiter({ max: 1, windowMs: 1000 });
    expect(l.allow("a", 0)).toBe(true);
    expect(l.allow("b", 0)).toBe(true);
    expect(l.allow("a", 1)).toBe(false);
  });

  it("forgets accounts that have gone quiet, so memory cannot grow without limit", () => {
    const l = createUserRateLimiter({ max: 1, windowMs: 10, maxKeys: 3 });
    for (let i = 0; i < 20; i++) l.allow(`user${i}`, i * 100);
    expect(l.allow("user0", 5000)).toBe(true); // an old, forgotten account starts fresh
  });
});
