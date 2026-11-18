import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  tracks: vi.fn(),
  playlists: vi.fn(),
  genres: vi.fn(),
  findFirst: vi.fn(),
  aggregate: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    track: { findMany: mocks.tracks },
    playlist: { findMany: mocks.playlists },
    trackGenre: { findMany: mocks.genres },
    playEvent: { findFirst: mocks.findFirst, aggregate: mocks.aggregate, create: mocks.create, update: mocks.update },
  },
}));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://x/api/stats/play", { method: "POST", body: JSON.stringify(body) }));
const seg = (over: Record<string, unknown> = {}) => ({ trackId: "t1", playlistId: "p1", seconds: 30, ...over });

beforeEach(() => {
  mocks.session = { user: { id: "u1" } };
  mocks.tracks.mockReset().mockResolvedValue([{ id: "t1", title: "Song", artist: "Artist" }]);
  mocks.playlists.mockReset().mockResolvedValue([{ id: "p1", name: "Workout" }]);
  mocks.genres.mockReset().mockResolvedValue([{ trackId: "t1", genre: "Hip-Hop" }]);
  // The account's last report was 30 s ago, with nothing credited yet today; no recent row to add into.
  mocks.findFirst.mockReset().mockImplementation(async (args: { select?: { updatedAt?: boolean } }) =>
    args.select?.updatedAt ? { updatedAt: new Date(Date.now() - 30_000) } : null,
  );
  mocks.aggregate.mockReset().mockResolvedValue({ _sum: { seconds: 0 } });
  mocks.create.mockReset().mockResolvedValue({});
  mocks.update.mockReset().mockResolvedValue({});
});

describe("POST /api/stats/play", () => {
  it("needs a signed-in account", async () => {
    mocks.session = null;
    expect((await post({ segments: [seg()] })).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("records nothing, and does not touch the database, for a report with nothing usable in it", async () => {
    for (const body of [null, {}, { segments: [] }, { segments: [seg({ seconds: -1 })] }]) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect((await res.json()).recorded).toBe(0);
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.tracks).not.toHaveBeenCalled();
  });

  it("records the listening for the signed-in account, with the song, genre and playlist copied in", async () => {
    const res = await post({ segments: [seg()] });
    expect((await res.json()).recorded).toBe(1);
    expect(mocks.create.mock.calls[0][0].data).toEqual({
      userId: "u1",
      trackId: "t1",
      playlistId: "p1",
      title: "Song",
      artist: "Artist",
      genre: "Hip-Hop",
      playlistName: "Workout",
      seconds: 30,
    });
  });

  it("never lets a report name another account: the account is always the signed-in one", async () => {
    await post({ segments: [seg({ userId: "someone-else" })] });
    expect(mocks.create.mock.calls[0][0].data.userId).toBe("u1");
  });

  it("only credits a playlist the account owns (the lookup is limited to their own)", async () => {
    mocks.playlists.mockResolvedValue([]); // p1 is somebody else's, so it is not found among this account's
    await post({ segments: [seg()] });
    expect(mocks.playlists.mock.calls[0][0].where).toEqual({ id: { in: ["p1"] }, userId: "u1" });
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ playlistId: null, playlistName: null });
  });

  it("skips a song that does not exist", async () => {
    const res = await post({ segments: [seg({ trackId: "ghost" })] });
    expect((await res.json()).recorded).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("adds to the row of the same song and playlist while the reports keep coming, instead of making a new one", async () => {
    mocks.findFirst.mockImplementation(async (args: { select?: { updatedAt?: boolean } }) =>
      args.select?.updatedAt ? { updatedAt: new Date(Date.now() - 30_000) } : { id: "row1" },
    );
    await post({ segments: [seg()] });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "row1" }, data: { seconds: { increment: 30 } } });
  });

  it("credits no more than the clock allows: a report claiming far more than the time since the last one is scaled down", async () => {
    await post({ segments: [seg({ seconds: 300 })] }); // 30 s after the last report, the budget is about 50 s
    const credited = mocks.create.mock.calls[0][0].data.seconds;
    expect(credited).toBeLessThan(60);
    expect(credited).toBeGreaterThan(0);
  });

  it("credits next to nothing for a report sent right after the last one (faster than real time)", async () => {
    mocks.findFirst.mockImplementation(async (args: { select?: { updatedAt?: boolean } }) => (args.select?.updatedAt ? { updatedAt: new Date() } : null));
    await post({ segments: [seg({ seconds: 300 })] });
    expect(mocks.create.mock.calls[0][0].data.seconds).toBeLessThan(10);
  });

  it("gives a first report a fixed allowance, and credits nothing once a day's worth is already credited", async () => {
    mocks.findFirst.mockImplementation(async (args: { select?: { updatedAt?: boolean } }) => (args.select?.updatedAt ? null : null));
    await post({ segments: [seg({ seconds: 300 })] });
    expect(mocks.create.mock.calls[0][0].data.seconds).toBe(90);

    mocks.create.mockClear();
    mocks.aggregate.mockResolvedValue({ _sum: { seconds: 24 * 60 * 60 } });
    expect((await (await post({ segments: [seg()] })).json()).recorded).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("still records a song when the genre tables are not there", async () => {
    mocks.genres.mockRejectedValue(new Error("relation does not exist"));
    await post({ segments: [seg()] });
    expect(mocks.create.mock.calls[0][0].data.genre).toBeNull();
  });

  it("answers 200 and keeps nothing, instead of failing the player, when the table is missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.findFirst.mockRejectedValue({ code: "P2021" });
    const res = await post({ segments: [seg()] });
    expect(res.status).toBe(200);
    expect((await res.json()).recorded).toBe(0);
  });
});
