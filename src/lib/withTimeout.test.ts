import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./withTimeout";

afterEach(() => vi.useRealTimers());

describe("withTimeout", () => {
  it("resolves with the value when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it("passes through the original rejection", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000)).rejects.toThrow("boom");
  });

  it("rejects once the time is up for a promise that never settles", async () => {
    vi.useFakeTimers();
    const hung = new Promise<void>(() => {});
    const result = withTimeout(hung, 500, "Track analysis");
    const assertion = expect(result).rejects.toThrow("Track analysis timed out after 500 ms");
    await vi.advanceTimersByTimeAsync(501);
    await assertion;
  });

  it("ignores a late result after it has already timed out", async () => {
    vi.useFakeTimers();
    let resolveLate: (v: string) => void = () => {};
    const late = new Promise<string>((r) => (resolveLate = r));
    const result = withTimeout(late, 100);
    const assertion = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    resolveLate("too late"); // must not throw or change anything
    await vi.advanceTimersByTimeAsync(10);
  });

  it("clears its timer when the promise settles first (nothing left pending)", async () => {
    vi.useFakeTimers();
    await withTimeout(Promise.resolve("ok"), 5000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
