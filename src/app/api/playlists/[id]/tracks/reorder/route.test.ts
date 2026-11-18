import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: "u-other", playlist: vi.fn(), updateMany: vi.fn(), audit: vi.fn() }));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: mocks.user } })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    playlist: { findUnique: mocks.playlist },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        $executeRaw: vi.fn(async () => 1),
        playlistTrack: {
          findMany: vi.fn(async () => [
            { trackId: "a", position: 0 },
            { trackId: "b", position: 1 },
          ]),
          updateMany: mocks.updateMany,
        },
      }),
  },
}));
vi.mock("@/lib/playlistApi", () => ({ loadPlaylist: vi.fn(async () => ({ id: "p1" })), toPlaylistApiResponse: () => ({ id: "p1", tracks: [] }) }));
vi.mock("@/lib/trackUserData", () => ({ loadUserTrackData: vi.fn(async () => new Map()) }));
vi.mock("@/lib/adminAudit", () => ({ recordAdminPlaylistAction: mocks.audit }));

import { PATCH } from "./route";

const ctx = { params: Promise.resolve({ id: "p1" }) };
const reorder = () => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ trackIds: ["b", "a"] }) }), ctx);

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_USER_IDS", "u-admin");
  vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
  mocks.user = "u-other";
  mocks.playlist.mockReset().mockResolvedValue({ id: "p1", userId: "u-owner", name: "Mine" });
  mocks.updateMany.mockReset().mockResolvedValue({ count: 1 });
  mocks.audit.mockReset().mockResolvedValue(undefined);
});

describe("reordering a playlist: the owner and the admin, nobody else", () => {
  it("answers 404 for another account, and changes nothing", async () => {
    expect((await reorder()).status).toBe(404);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("lets the owner reorder their own", async () => {
    mocks.user = "u-owner";
    expect((await reorder()).status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalled();
  });

  it("lets the admin reorder another account's playlist, and logs it", async () => {
    mocks.user = "u-admin";
    expect((await reorder()).status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: "u-admin", action: "playlist.reorder" }));
  });
});
