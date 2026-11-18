import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: "u-other", findMany: vi.fn(), count: vi.fn(), saveMany: vi.fn() }));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: mocks.user } })) }));
vi.mock("@/lib/prisma", () => ({ prisma: { trackGenre: { findMany: mocks.findMany, count: mocks.count } } }));
vi.mock("@/lib/genre/prismaStore", () => ({
  genreTablesReady: async () => true,
  prismaGenreStore: { saveMany: mocks.saveMany },
  storedFromRow: (row: unknown) => row,
}));
vi.mock("@/lib/genre/stored", () => ({ acceptBest: () => null, confirmCurrent: () => null }));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_USER_IDS", "u-admin");
  vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
  mocks.user = "u-other";
  mocks.findMany.mockReset().mockResolvedValue([]);
  mocks.count.mockReset().mockResolvedValue(0);
  mocks.saveMany.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/genre/review changes genres on shared songs: admin only", () => {
  it("refuses anyone else without reading or saving anything", async () => {
    const res = await post({ action: "accept-above" });
    expect(res.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.saveMany).not.toHaveBeenCalled();
  });

  it("lets the admin work through every song waiting for review, whoever added it", async () => {
    mocks.user = "u-admin";
    const res = await post({ action: "accept-above" });
    expect(res.status).toBe(200);
    // No owner filter: the queue is the whole library's.
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ status: "needs-review" });
    expect(mocks.count).toHaveBeenCalledWith({ where: { status: "needs-review" } });
  });
});
