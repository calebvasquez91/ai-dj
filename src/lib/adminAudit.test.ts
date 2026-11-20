import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUser: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUser }, adminAction: { create: mocks.create } } }));

import { recordAdminLibraryEdit, recordAdminPlaylistAction } from "./adminAudit";

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

describe("recordAdminLibraryEdit", () => {
  const track = { id: "t1", artist: "", title: "Bidi", userId: "owner", bpm: null, key: "A minor", tagsJson: null };

  it("logs what changed with the old values, under the song's new name", async () => {
    await recordAdminLibraryEdit({ actorId: "admin", track, changed: { artist: "Selena", bpm: 98, key: "C major" } });
    const data = mocks.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ adminId: "admin", action: "library.edit-song", playlistId: null, playlistName: "Selena - Bidi", ownerId: "owner", ownerEmail: "owner@example.com" });
    expect(data.detail).toBe('track t1; artist was ""; bpm was empty; key was A minor');
  });

  it("never lets a logging failure undo the edit", async () => {
    mocks.create.mockRejectedValue(new Error("table missing"));
    await expect(recordAdminLibraryEdit({ actorId: "admin", track, changed: { title: "Bidi Bidi" } })).resolves.toBeUndefined();
  });
});
