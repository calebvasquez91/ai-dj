import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  tracks: vi.fn(),
  playlists: vi.fn(),
  genres: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    track: { findMany: mocks.tracks },
    playlist: { findMany: mocks.playlists },
    trackGenre: { findMany: mocks.genres },
    playEvent: { createMany: mocks.create },
  },
}));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://x/api/stats/play", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  mocks.session = { user: { id: "u1" } };
  mocks.tracks.mockReset().mockResolvedValue([{ id: "t1", title: "Song", artist: "Artist" }]);
  mocks.playlists.mockReset().mockResolvedValue([{ id: "p1", name: "Workout" }]);
  mocks.genres.mockReset().mockResolvedValue([{ trackId: "t1", genre: "Hip-Hop" }]);
  mocks.create.mockReset().mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
});

describe("POST /api/stats/play", () => {
  it("needs a signed-in account", async () => {
    mocks.session = null;
    expect((await post({ segments: [{ trackId: "t1", seconds: 30 }] })).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("records nothing, and does not touch the database, for a report with nothing usable in it", async () => {
    for (const body of [null, {}, { segments: [] }, { segments: [{ trackId: "t1", seconds: -1 }] }]) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect((await res.json()).recorded).toBe(0);
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.tracks).not.toHaveBeenCalled();
  });

  it("records the listening for the signed-in account, with the song, genre and playlist copied in", async () => {
    const res = await post({ segments: [{ trackId: "t1", playlistId: "p1", seconds: 30 }] });
    expect((await res.json()).recorded).toBe(1);
    expect(mocks.create.mock.calls[0][0].data).toEqual([
      { userId: "u1", trackId: "t1", playlistId: "p1", title: "Song", artist: "Artist", genre: "Hip-Hop", playlistName: "Workout", seconds: 30 },
    ]);
  });

  it("never lets a report name another account: the account is always the signed-in one", async () => {
    await post({ segments: [{ trackId: "t1", seconds: 10, userId: "someone-else" }] });
    expect(mocks.create.mock.calls[0][0].data[0].userId).toBe("u1");
  });

  it("skips a song that does not exist, and records a playlist that does not exist as no playlist", async () => {
    mocks.playlists.mockResolvedValue([]);
    const res = await post({
      segments: [
        { trackId: "ghost", seconds: 20 },
        { trackId: "t1", playlistId: "gone", seconds: 15 },
      ],
    });
    expect((await res.json()).recorded).toBe(1);
    expect(mocks.create.mock.calls[0][0].data).toEqual([
      { userId: "u1", trackId: "t1", playlistId: null, title: "Song", artist: "Artist", genre: "Hip-Hop", playlistName: null, seconds: 15 },
    ]);
  });

  it("still records a song when the genre tables are not there", async () => {
    mocks.genres.mockRejectedValue(new Error("relation does not exist"));
    await post({ segments: [{ trackId: "t1", seconds: 12 }] });
    expect(mocks.create.mock.calls[0][0].data[0].genre).toBeNull();
  });

  it("answers 200 and keeps nothing, instead of failing the player, when the table is missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.create.mockRejectedValue({ code: "P2021" });
    const res = await post({ segments: [{ trackId: "t1", seconds: 12 }] });
    expect(res.status).toBe(200);
    expect((await res.json()).recorded).toBe(0);
  });
});
