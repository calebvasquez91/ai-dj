import { describe, expect, it } from "vitest";
import { corsVerdict, licenseMix, streamUrlInfo } from "@/lib/catalog/probe";

const headers = (map: Record<string, string>) => ({ get: (name: string) => map[name.toLowerCase()] ?? null });

describe("streamUrlInfo", () => {
  it("says whether, and where, the client id is in a stream URL", () => {
    const info = streamUrlInfo("https://prod-1.storage.jamendo.com/?trackid=1&format=mp32&from=app-97dab294", "97dab294");
    expect(info).toEqual({ host: "prod-1.storage.jamendo.com", carriesClientId: true, paramsWithClientId: ["from"] });
  });
  it("is clean when the id isn't there", () => {
    expect(streamUrlInfo("https://prod-1.storage.jamendo.com/?trackid=1&format=mp32", "97dab294")).toEqual({
      host: "prod-1.storage.jamendo.com",
      carriesClientId: false,
      paramsWithClientId: [],
    });
  });
  it("finds the id outside the query string too, and copes with a bad URL or no id", () => {
    expect(streamUrlInfo("https://cdn.jamendo.com/97dab294/track.mp3", "97dab294")).toMatchObject({ carriesClientId: true, paramsWithClientId: [] });
    expect(streamUrlInfo("nonsense", "97dab294").host).toBe("(not a URL)");
    expect(streamUrlInfo("https://a.jamendo.com/?x=1", "").carriesClientId).toBe(false);
  });
});

describe("corsVerdict", () => {
  const origin = "https://ai-dj-gamma.vercel.app";
  it("allows a wildcard or our own origin", () => {
    expect(corsVerdict(headers({ "access-control-allow-origin": "*" }), origin)).toBe("allowed");
    expect(corsVerdict(headers({ "access-control-allow-origin": origin }), origin)).toBe("allowed");
    expect(corsVerdict(headers({ "access-control-allow-origin": origin.toUpperCase() }), origin)).toBe("allowed");
  });
  it("says so when the header is missing, or names another site", () => {
    expect(corsVerdict(headers({}), origin)).toBe("no-cors-header");
    expect(corsVerdict(headers({ "access-control-allow-origin": "https://www.jamendo.com" }), origin)).toBe("other-origin-only");
  });
});

describe("licenseMix", () => {
  it("counts each license and how many the app's rules allow", () => {
    const mix = licenseMix([
      "https://creativecommons.org/licenses/by/4.0/",
      "https://creativecommons.org/licenses/by-nc-sa/3.0/",
      "https://creativecommons.org/licenses/by-nc/3.0/",
      "https://creativecommons.org/publicdomain/zero/1.0/",
      "https://creativecommons.org/licenses/by-sa/4.0/",
      "all rights reserved",
      null,
      undefined,
    ]);
    expect(mix.total).toBe(8);
    expect(mix.usable).toBe(2); // CC BY and CC0
    expect(mix.byCode).toEqual({ by: 1, "by-nc-sa": 1, "by-nc": 1, cc0: 1, "by-sa": 1, unreadable: 3 });
  });
  it("handles an empty page", () => {
    expect(licenseMix([])).toEqual({ total: 0, byCode: {}, usable: 0 });
  });
});
