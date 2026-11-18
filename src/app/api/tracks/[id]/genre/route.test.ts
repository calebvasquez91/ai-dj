import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: "u-other", trackFind: vi.fn(), get: vi.fn(), save: vi.fn() }));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: mocks.user } })) }));
vi.mock("@/lib/prisma", () => ({ prisma: { track: { findUnique: mocks.trackFind } } }));
vi.mock("@/lib/genre/prismaStore", () => ({
  genreTablesReady: async () => true,
  prismaGenreStore: { get: mocks.get, save: mocks.save },
}));

import { DELETE, PUT } from "./route";

const ctx = { params: Promise.resolve({ id: "t1" }) };
const put = (picks: unknown) => PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ picks }) }), ctx);

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_USER_IDS", "u-admin");
  vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
  mocks.user = "u-other";
  mocks.trackFind.mockReset().mockResolvedValue({ id: "t1" }); // somebody else's upload: the library is shared
  mocks.get.mockReset().mockResolvedValue(null);
  mocks.save.mockReset().mockResolvedValue(undefined);
});

describe("a song's genres belong to the shared song: only the admin changes them", () => {
  it("refuses everybody else, and saves nothing", async () => {
    expect((await put([{ genre: "Jazz" }])).status).toBe(403);
    expect((await DELETE(new Request("http://x", { method: "DELETE" }), ctx)).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("lets the admin set the genres of a song somebody else added", async () => {
    mocks.user = "u-admin";
    const res = await put([{ genre: "Jazz" }]);
    expect(res.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0]).toBe("t1");
  });

  it("is a 404 for a song that does not exist", async () => {
    mocks.user = "u-admin";
    mocks.trackFind.mockResolvedValue(null);
    expect((await put([{ genre: "Jazz" }])).status).toBe(404);
  });
});
