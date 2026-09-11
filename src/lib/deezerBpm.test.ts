import { describe, expect, it, vi, afterEach } from "vitest";
import { lookupBpmFromDeezer } from "./deezerBpm";

describe("lookupBpmFromDeezer", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns the bpm for a found track", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/search")) {
        return new Response(JSON.stringify({ data: [{ id: 123 }] })) as unknown as Response;
      }
      if (url.includes("/track/123")) {
        return new Response(JSON.stringify({ bpm: 128.4 })) as unknown as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    expect(await lookupBpmFromDeezer("Song", "Artist")).toBe(128.4);
  });

  it("returns null when search finds no match", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [] }))) as unknown as typeof fetch;
    expect(await lookupBpmFromDeezer("Nope", "Nobody")).toBeNull();
  });

  it("returns null when bpm is missing or zero", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/search")) {
        return new Response(JSON.stringify({ data: [{ id: 1 }] })) as unknown as Response;
      }
      return new Response(JSON.stringify({ bpm: 0 })) as unknown as Response;
    }) as unknown as typeof fetch;
    expect(await lookupBpmFromDeezer("Song", "Artist")).toBeNull();
  });

  it("returns null on a non-ok response instead of throwing", async () => {
    global.fetch = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    expect(await lookupBpmFromDeezer("Song", "Artist")).toBeNull();
  });

  it("returns null on network failure without throwing", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(lookupBpmFromDeezer("Song", "Artist")).resolves.toBeNull();
  });
});
