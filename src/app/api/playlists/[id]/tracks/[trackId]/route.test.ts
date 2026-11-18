import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: "u-other", playlist: vi.fn(), track: vi.fn(), deleteMany: vi.fn(), audit: vi.fn() }));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: mocks.user } })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { playlist: { findUnique: mocks.playlist }, track: { findUnique: mocks.track }, playlistTrack: { deleteMany: mocks.deleteMany } },
}));
vi.mock("@/lib/adminAudit", () => ({ recordAdminPlaylistAction: mocks.audit }));

import { DELETE } from "./route";

const ctx = { params: Promise.resolve({ id: "p1", trackId: "t1" }) };
const remove = () => DELETE(new Request("http://x", { method: "DELETE" }), ctx);

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_USER_IDS", "u-admin");
  vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
  mocks.user = "u-other";
  mocks.playlist.mockReset().mockResolvedValue({ id: "p1", userId: "u-owner", name: "Mine" });
  mocks.track.mockReset().mockResolvedValue({ title: "Song", artist: "Artist" });
  mocks.deleteMany.mockReset().mockResolvedValue({ count: 1 });
  mocks.audit.mockReset().mockResolvedValue(undefined);
});

describe("taking a song out of a playlist: the owner and the admin, nobody else", () => {
  it("answers 404 for another account, and removes nothing", async () => {
    expect((await remove()).status).toBe(404);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("lets the owner remove from their own", async () => {
    mocks.user = "u-owner";
    expect((await remove()).status).toBe(204);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { playlistId: "p1", trackId: "t1" } });
  });

  it("lets the admin remove from another account's playlist, and logs it", async () => {
    mocks.user = "u-admin";
    expect((await remove()).status).toBe(204);
    expect(mocks.deleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: "u-admin", action: "playlist.remove-song", detail: "Song - Artist" }));
  });
});
