import { describe, expect, it } from "vitest";
import { BoundedCache } from "./boundedCache";

describe("BoundedCache", () => {
  it("stores and returns entries", () => {
    const c = new BoundedCache<number>(2);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    expect(c.get("missing")).toBeUndefined();
  });

  it("drops the least recently used entry past maxSize", () => {
    const c = new BoundedCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });

  it("get counts as a use", () => {
    const c = new BoundedCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a is now newer than b
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
  });

  it("peek does not count as a use", () => {
    const c = new BoundedCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.peek("a");
    c.set("c", 3);
    expect(c.peek("a")).toBeUndefined();
  });

  it("re-setting a key refreshes it without growing", () => {
    const c = new BoundedCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 9);
    expect(c.size).toBe(2);
    c.set("c", 3);
    expect(c.peek("b")).toBeUndefined();
    expect(c.peek("a")).toBe(9);
  });

  it("delete and clear remove entries", () => {
    const c = new BoundedCache<number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.delete("a");
    expect(c.size).toBe(1);
    c.clear();
    expect(c.size).toBe(0);
  });
});
