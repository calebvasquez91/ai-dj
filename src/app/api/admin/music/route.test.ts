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
const song = { id: "t1", artist: "Selena", title: "Bidi", bpm: null, key: null, camelotKey: null, tagsJson: null, durationSec: 100, createdAt: new Date("2026-11-19T00:00:00Z"), genreInfo: null, _count: { playEvents: 2 } };

beforeEach(() => {
  mocks.owner = true;
  mocks.count.mockReset().mockResolvedValue(120);
  mocks.findMany.mockReset().mockResolvedValue([song]);
});

describe("GET /api/admin/music", () => {
  it("does not exist for anyone but the admin, and reads nothing", async () => {
    mocks.owner = false;
    expect((await get()).status).toBe(404);
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("returns one page of rows with the totals and the missing-info counts", async () => {
    const res = await get("q=selena&page=2&pageSize=25&sort=plays&dir=desc");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ total: 120, page: 2, pages: 5, pageSize: 25, counts: { library: 120, missingAny: 120 } });
    expect(body.rows[0]).toMatchObject({ id: "t1", plays: 2, missing: ["genre"] });
    const args = mocks.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 25, take: 25 });
    expect(JSON.stringify(args.where)).toContain("selena");
    expect(args.orderBy[0]).toEqual({ playEvents: { _count: "desc" } });
  });

  it("shows the last page when the asked-for page is past the end", async () => {
    const body = await (await get("page=99&pageSize=50")).json();
    expect(body.page).toBe(3);
    expect(mocks.findMany.mock.calls[0][0].skip).toBe(100);
  });
});
