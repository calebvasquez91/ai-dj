import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deserializeFingerprint,
  fingerprintFromText,
  getLyricalFingerprint,
  serializeFingerprint,
} from "./lyrics";

describe("fingerprintFromText", () => {
  it("strips stopwords and short tokens, keeping meaningful words", () => {
    const fp = fingerprintFromText("I am dancing and dancing under the neon lights of the city");
    expect(fp.words.has("dancing")).toBe(true);
    expect(fp.words.has("neon")).toBe(true);
    expect(fp.words.has("lights")).toBe(true);
    expect(fp.words.has("city")).toBe(true);
    expect(fp.words.has("the")).toBe(false);
    expect(fp.words.has("and")).toBe(false);
    expect(fp.words.has("am")).toBe(false);
  });

  it("never includes the raw text itself in the fingerprint's own fields", () => {
    const fp = fingerprintFromText("a very specific and unusual sentence about lighthouses");
    const serialized = JSON.stringify(serializeFingerprint(fp));
    expect(serialized).not.toContain("very specific and unusual sentence");
  });
});

describe("serializeFingerprint / deserializeFingerprint", () => {
  it("round-trips a fingerprint through plain-array form", () => {
    const original = fingerprintFromText("dancing under neon city lights all night long");
    const roundTripped = deserializeFingerprint(serializeFingerprint(original));
    expect([...roundTripped.words].sort()).toEqual([...original.words].sort());
    expect([...roundTripped.moodTags].sort()).toEqual([...original.moodTags].sort());
  });
});

describe("getLyricalFingerprint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a fingerprint built from the first match's plainLyrics", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { plainLyrics: "dancing all night under the neon city lights", instrumental: false },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const fp = await getLyricalFingerprint("Some Song", "Some Artist");
    expect(fp).not.toBeNull();
    expect(fp?.words.has("dancing")).toBe(true);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("track_name=Some+Song");
    expect(url).toContain("artist_name=Some+Artist");
  });

  it("omits artist_name from the query when the artist is the loose-parser's Unknown Artist fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);

    await getLyricalFingerprint("Some Song", "Unknown Artist");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain("artist_name");
  });

  it("resolves null (not an error) when nothing matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    await expect(getLyricalFingerprint("Nonexistent Track", "Nobody")).resolves.toBeNull();
  });

  it("resolves null when the only match is instrumental", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ plainLyrics: null, instrumental: true }],
      })
    );
    await expect(getLyricalFingerprint("Some Instrumental", "Some Artist")).resolves.toBeNull();
  });

  it("throws (does not silently resolve null) on a failed request, so callers can tell a real miss apart from a transient error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(getLyricalFingerprint("Some Song", "Some Artist")).rejects.toThrow();
  });
});
