import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  owner: true,
  count: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock("@/lib/feedbackOwner", () => ({ feedbackOwnerSession: vi.fn(async () => (mocks.owner ? { user: { id: "u-admin" } } : null)) }));
vi.mock("@/lib/prisma", () => ({ prisma: { track: { count: mocks.count, findMany: mocks.findMany } } }));

import { GET } from "./route";

const get = (qs = "") => GET(new Request(`http://x/api/admin/music?${qs}`));
const song = (id: string, camelotKey: string | null = null) => ({
  id,
  artist: "Selena",
  title: `Bidi ${id}`,
  bpm: null,
  key: null,
  camelotKey,
  tagsJson: null,
  durationSec: 100,
  createdAt: new Date("2026-11-19T00:00:00Z"),
  genreInfo: null,
  _count: { playEvents: 2 },
});

beforeEach(() => {
  mocks.owner = true;
  mocks.count.mockReset().mockResolvedValue(120);
  mocks.findMany.mockReset().mockResolvedValue([song("t1")]);
});

describe("GET /api/admin/music", () => {
  it("does not exist for anyone but the admin, and reads nothing", async () => {
    mocks.owner = false;
    expect((await get()).status).toBe(404);
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("returns one page of rows with the total, and the library-wide counts only when asked", async () => {
    const res = await get("q=selena&page=2&pageSize=25&sort=plays&dir=desc&counts=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ total: 120, page: 2, pages: 5, pageSize: 25, counts: { library: 120, missingAny: 120 } });
    expect(body.rows[0]).toMatchObject({ id: "t1", plays: 2, analysed: false, missing: ["genre"] });
    const args = mocks.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 25, take: 25 });
    expect(JSON.stringify(args.where)).toContain("selena");
    expect(args.orderBy[0]).toEqual({ playEvents: { _count: "desc" } });
  });

  it("runs only the search's own count on an ordinary request (the library-wide counts do not depend on it)", async () => {
    const body = await (await get("q=sel")).json();
    expect(body.counts).toBeNull();
    expect(mocks.count).toHaveBeenCalledTimes(1);
  });

  it("shows the last page when the asked-for page is past the end", async () => {
    const body = await (await get("page=99&pageSize=50")).json();
    expect(body.page).toBe(3);
    expect(mocks.findMany.mock.calls[0][0].skip).toBe(100);
  });

  it("sorts by key in Camelot wheel order, reading only the page's rows after", async () => {
    mocks.count.mockResolvedValue(5);
    const keys: Record<string, string | null> = { a: "10A", b: "2A", c: null, d: "1B", e: "12B" };
    mocks.findMany
      .mockResolvedValueOnce(Object.entries(keys).map(([id, camelotKey]) => ({ id, camelotKey })))
      .mockImplementationOnce(async (args: { where: { id: { in: string[] } } }) => args.where.id.in.map((id) => song(id, keys[id])));
    const body = await (await get("sort=key&dir=asc&pageSize=25")).json();
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(["d", "b", "a", "e", "c"]);
    // The first read is every match (id and key only); the second is the page.
    expect(mocks.findMany.mock.calls[0][0].select).toEqual({ id: true, camelotKey: true });
    expect(mocks.findMany.mock.calls[1][0].where).toEqual({ id: { in: ["d", "b", "a", "e", "c"] } });
  });

  it("pages the key sort: page 2 is the next slice of the wheel order", async () => {
    mocks.count.mockResolvedValue(30);
    const all = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, camelotKey: `${(i % 12) + 1}A` }));
    mocks.findMany
      .mockResolvedValueOnce(all)
      .mockImplementationOnce(async (args: { where: { id: { in: string[] } } }) => args.where.id.in.map((id) => song(id)));
    const body = await (await get("sort=key&pageSize=25&page=2")).json();
    expect(body.rows).toHaveLength(5);
    expect(body.page).toBe(2);
  });
});
