import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUser: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUser }, adminAction: { create: mocks.create } } }));

import { recordAdminPlaylistAction } from "./adminAudit";

const playlist = { id: "p1", name: "Workout", userId: "owner" };

beforeEach(() => {
  mocks.findUser.mockReset().mockResolvedValue({ email: "owner@example.com" });
  mocks.create.mockReset().mockResolvedValue({});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("recordAdminPlaylistAction", () => {
  it("writes a line for a change to somebody else's playlist, with the playlist's name and the owner's email copied in", async () => {
    await recordAdminPlaylistAction({ actorId: "admin", action: "playlist.rename", playlist, detail: "Workout -> Gym" });
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        adminId: "admin",
        action: "playlist.rename",
        playlistId: "p1",
        playlistName: "Workout",
        ownerId: "owner",
        ownerEmail: "owner@example.com",
        detail: "Workout -> Gym",
      },
    });
  });

  it("writes nothing when the actor is the owner (the admin on their own playlists)", async () => {
    await recordAdminPlaylistAction({ actorId: "owner", action: "playlist.delete", playlist });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("never fails the change it is logging, whatever goes wrong", async () => {
    mocks.create.mockRejectedValue({ code: "P2021" });
    await expect(recordAdminPlaylistAction({ actorId: "admin", action: "playlist.delete", playlist })).resolves.toBeUndefined();
  });
});
