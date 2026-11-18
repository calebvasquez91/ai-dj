import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: "u-other", findUnique: vi.fn(), update: vi.fn(), del: vi.fn(), audit: vi.fn() }));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: mocks.user } })) }));
vi.mock("@/lib/prisma", () => ({ prisma: { playlist: { findUnique: mocks.findUnique, update: mocks.update, delete: mocks.del } } }));
vi.mock("@/lib/playlistApi", () => ({
  loadPlaylist: vi.fn(async () => ({ id: "p1" })),
  toPlaylistApiResponse: () => ({ id: "p1", name: "renamed", tracks: [] }),
}));
vi.mock("@/lib/trackUserData", () => ({ loadUserTrackData: vi.fn(async () => new Map()) }));
vi.mock("@/lib/adminAudit", () => ({ recordAdminPlaylistAction: mocks.audit }));

import { DELETE, PATCH } from "./route";

const ctx = { params: Promise.resolve({ id: "p1" }) };
const rename = () => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "renamed" }) }), ctx);
const remove = () => DELETE(new Request("http://x", { method: "DELETE" }), ctx);

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_USER_IDS", "u-admin");
  vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
  mocks.user = "u-other";
  mocks.findUnique.mockReset().mockResolvedValue({ id: "p1", userId: "u-owner", theme: null, name: "Mine" });
  mocks.update.mockReset().mockResolvedValue({});
  mocks.del.mockReset().mockResolvedValue({});
  mocks.audit.mockReset().mockResolvedValue(undefined);
});

describe("renaming and deleting a playlist: the owner and the admin, nobody else", () => {
  it("answers 404 for another account, and changes nothing", async () => {
    expect((await rename()).status).toBe(404);
    expect((await remove()).status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("lets the owner rename and delete their own", async () => {
    mocks.user = "u-owner";
    expect((await rename()).status).toBe(200);
    expect((await remove()).status).toBe(204);
  });

  it("lets the admin rename and delete another account's playlist", async () => {
    mocks.user = "u-admin";
    expect((await rename()).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { name: "renamed" } });
    expect((await remove()).status).toBe(204);
    expect(mocks.del).toHaveBeenCalledWith({ where: { id: "p1" } });
  });

  it("logs what the admin changed on another account's playlist, so it can be explained afterwards", async () => {
    mocks.user = "u-admin";
    await rename();
    await remove();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: "u-admin", action: "playlist.rename", detail: "Mine -> renamed" }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: "u-admin", action: "playlist.delete" }));
  });

  it("still refuses to delete a system playlist, even for the admin", async () => {
    mocks.user = "u-admin";
    mocks.findUnique.mockResolvedValue({ id: "p1", userId: "u-owner", theme: "spooky", name: "Spooky Music" });
    expect((await remove()).status).toBe(400);
    expect(mocks.del).not.toHaveBeenCalled();
  });
});
