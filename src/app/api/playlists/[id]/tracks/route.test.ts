import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: "u-other", playlist: vi.fn(), track: vi.fn(), upsert: vi.fn(), audit: vi.fn() }));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: mocks.user } })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    playlist: { findUnique: mocks.playlist },
    track: { findUnique: mocks.track },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ $executeRaw: vi.fn(async () => 1), playlistTrack: { findFirst: vi.fn(async () => null), upsert: mocks.upsert } }),
  },
}));
vi.mock("@/lib/playlistApi", () => ({ loadPlaylist: vi.fn(async () => ({ id: "p1" })), toPlaylistApiResponse: () => ({ id: "p1", tracks: [] }) }));
vi.mock("@/lib/trackUserData", () => ({ loadUserTrackData: vi.fn(async () => new Map()) }));
vi.mock("@/lib/adminAudit", () => ({ recordAdminPlaylistAction: mocks.audit }));

import { POST } from "./route";

const ctx = { params: Promise.resolve({ id: "p1" }) };
const add = () => POST(new Request("http://x", { method: "POST", body: JSON.stringify({ trackId: "t1" }) }), ctx);

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_USER_IDS", "u-admin");
  vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
  mocks.user = "u-other";
  mocks.playlist.mockReset().mockResolvedValue({ id: "p1", userId: "u-owner", name: "Mine" });
  mocks.track.mockReset().mockResolvedValue({ id: "t1", title: "Song", artist: "Artist" });
  mocks.upsert.mockReset().mockResolvedValue({});
  mocks.audit.mockReset().mockResolvedValue(undefined);
});

describe("adding a song to a playlist: the owner and the admin, nobody else", () => {
  it("answers 404 for another account, and adds nothing", async () => {
    expect((await add()).status).toBe(404);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("lets the owner add to their own", async () => {
    mocks.user = "u-owner";
    expect((await add()).status).toBe(201);
  });

  it("lets the admin add to another account's playlist, and logs it", async () => {
    mocks.user = "u-admin";
    expect((await add()).status).toBe(201);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: "u-admin", action: "playlist.add-song", detail: "Song - Artist" }));
  });
});
