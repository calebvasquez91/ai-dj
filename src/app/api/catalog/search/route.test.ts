import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => (mocks.user ? { user: mocks.user } : null)) }));

import { GET } from "./route";

const realKey = process.env.JAMENDO_CLIENT_ID;

function jamendoTrack(id: string, license = "https://creativecommons.org/licenses/by/4.0/") {
  return {
    id,
    name: `Track ${id}`,
    duration: 200,
    artist_name: "Kite Runner",
    license_ccurl: license,
    audio: `https://prod-1.storage.jamendo.com/?trackid=${id}&format=mp32`,
    shareurl: `https://www.jamendo.com/track/${id}`,
  };
}
const jamendoPage = (results: unknown[]) => ({ headers: { status: "success", code: 0 }, results });
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Distinct search text per test so the route's per-process result cache never answers for a different test. */
let n = 0;
const request = (qs = "") => new Request(`http://x/api/catalog/search?q=test${++n}${qs ? `&${qs}` : ""}`);

beforeEach(() => {
  mocks.user = { id: `user${n}` };
  process.env.JAMENDO_CLIENT_ID = "secret-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (realKey === undefined) delete process.env.JAMENDO_CLIENT_ID;
  else process.env.JAMENDO_CLIENT_ID = realKey;
});

describe("GET /api/catalog/search", () => {
  it("needs a signed-in user", async () => {
    mocks.user = null;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(request())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a bad query before calling the catalog", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await GET(request("speed=warp"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/speed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 503 when this server has no Jamendo client id", async () => {
    delete process.env.JAMENDO_CLIENT_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns only usable tracks, with credit lines and paging, and sends the key only to Jamendo", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(jamendoPage([jamendoTrack("1"), jamendoTrack("2", "https://creativecommons.org/licenses/by-nc/3.0/"), jamendoTrack("3")]))
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await GET(request("limit=3&tags=house"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tracks.map((t: { id: string }) => t.id)).toEqual(["jamendo:1", "jamendo:3"]);
    expect(body.skipped).toEqual({ invalid: 0, license: 1 });
    expect(body.nextOffset).toBeNull(); // Jamendo sent fewer than the 9 it was asked for: that was all of them
    expect(body.tracks[0].attribution.text).toBe("“Track 1” by Kite Runner, via Jamendo. CC BY 4.0. Tempo and pitch adjusted for mixing.");
    expect(JSON.stringify(body)).not.toContain("secret-key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const called = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(called).toContain("client_id=secret-key");
    expect(called).toContain("tags=house");
    expect(called).toContain("limit=9"); // asks for a bigger page than the 3 wanted, as most tracks are filtered out
  });

  it("answers an identical search from the cache", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(jamendoPage([jamendoTrack("1")])));
    vi.stubGlobal("fetch", fetchMock);
    const req = () => new Request("http://x/api/catalog/search?q=cached-search");
    expect((await GET(req())).status).toBe(200);
    expect((await GET(req())).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("answers 502 when the catalog fails, without leaking the key or the URL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed for https://api.jamendo.com/v3.0/tracks/?client_id=secret-key");
    }));
    const res = await GET(request());
    expect(res.status).toBe(502);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("secret-key");
    expect(text).not.toContain("jamendo.com");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-key");
  });

  it("answers 502 when Jamendo refuses the key (it does so with HTTP 200)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ headers: { status: "failed", code: 5, error_message: "Invalid client_id" }, results: [] })));
    expect((await GET(request())).status).toBe(502);
  });

  it("limits how often one person can search", async () => {
    mocks.user = { id: "heavy-user" };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(jamendoPage([jamendoTrack("1")]))));
    const statuses: number[] = [];
    for (let i = 0; i < 62; i++) statuses.push((await GET(request())).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(60)).toEqual([429, 429]);
    // Someone else is unaffected.
    mocks.user = { id: "other-user" };
    expect((await GET(request())).status).toBe(200);
  });
});
