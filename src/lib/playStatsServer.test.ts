import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  aggregate: vi.fn(),
  userFindMany: vi.fn(),
  playlistFindMany: vi.fn(),
  genreFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    playEvent: { groupBy: mocks.groupBy, aggregate: mocks.aggregate },
    user: { findMany: mocks.userFindMany },
    playlist: { findMany: mocks.playlistFindMany },
    trackGenre: { findMany: mocks.genreFindMany },
  },
}));

import { isMissingTable, loadPlayStats, totalListenedSeconds } from "./playStatsServer";

const sum = (seconds: number | null) => ({ _sum: { seconds } });

beforeEach(() => {
  mocks.groupBy.mockReset().mockImplementation(async (args: { by: string[] }) => {
    const by = args.by.join(",");
    if (by === "userId") return [{ userId: "u1", ...sum(900) }];
    if (by === "trackId,genre") return [{ trackId: "t1", genre: null, ...sum(600) }, { trackId: "t2", genre: "Pop", ...sum(300) }];
    if (by === "playlistId,playlistName") return [{ playlistId: "p1", playlistName: "Workout", ...sum(500) }];
    if (by === "trackId,title,artist") return [{ trackId: "t1", title: "Song", artist: "Artist", ...sum(600) }];
    return [];
  });
  mocks.aggregate.mockReset().mockResolvedValue(sum(900));
  mocks.userFindMany.mockReset().mockResolvedValue([{ id: "u1", email: "u1@example.com", name: "One" }]);
  mocks.playlistFindMany.mockReset().mockResolvedValue([{ id: "p1", user: { email: "u1@example.com", name: "One" } }]);
  // t1 has been classified since it was played; t2 was corrected from Pop to Rock.
  mocks.genreFindMany.mockReset().mockResolvedValue([{ trackId: "t1", genre: "Funk" }, { trackId: "t2", genre: "Rock" }]);
});

describe("loadPlayStats", () => {
  it("reports the hours by account, playlist and song, and the genre each song has NOW", async () => {
    const result = await loadPlayStats({ days: null, accountId: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.totalSeconds).toBe(900);
    expect(result.report.accounts[0]).toMatchObject({ id: "u1", label: "One (u1@example.com)", seconds: 900 });
    expect(result.report.genres.map((g) => [g.label, g.seconds])).toEqual([["Funk", 600], ["Rock", 300]]);
    expect(result.report.playlists[0]).toMatchObject({ label: "Workout", sub: "One (u1@example.com)", seconds: 500 });
    expect(result.report.songs[0]).toMatchObject({ label: "Song", sub: "Artist", seconds: 600 });
  });

  it("limits everything but the account list to the chosen account, and the period to the last N days", async () => {
    await loadPlayStats({ days: 7, accountId: "u1", now: Date.UTC(2026, 10, 18, 12) });
    const wheres = mocks.groupBy.mock.calls.map(([args]) => ({ by: args.by.join(","), where: args.where }));
    const accounts = wheres.find((w) => w.by === "userId")!.where;
    expect(accounts.userId).toBeUndefined(); // the picker always lists every account
    expect(accounts.createdAt.gte.toISOString()).toBe("2026-11-11T12:00:00.000Z");
    for (const w of wheres.filter((x) => x.by !== "userId")) expect(w.where.userId).toBe("u1");
  });

  it("falls back to the genre recorded at the time when the genre tables are not there", async () => {
    mocks.genreFindMany.mockRejectedValue(new Error("relation does not exist"));
    const result = await loadPlayStats({ days: null, accountId: null });
    if (!result.ok) throw new Error("expected ok");
    expect(result.report.genres.map((g) => g.label).sort()).toEqual(["Not classified", "Pop"]);
  });

  it("says the table is missing only for that error, and 'error' for anything else", async () => {
    mocks.groupBy.mockRejectedValue({ code: "P2021" });
    expect(await loadPlayStats({ days: null, accountId: null })).toEqual({ ok: false, reason: "no-table" });
    mocks.groupBy.mockRejectedValue(new Error("Connection terminated unexpectedly"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadPlayStats({ days: null, accountId: null })).toEqual({ ok: false, reason: "error" });
  });
});

describe("totalListenedSeconds", () => {
  it("is the total, null when the table is missing, and 'error' for any other failure", async () => {
    expect(await totalListenedSeconds()).toBe(900);
    mocks.aggregate.mockRejectedValueOnce(new Error('relation "PlayEvent" does not exist'));
    expect(await totalListenedSeconds()).toBeNull();
    mocks.aggregate.mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
    expect(await totalListenedSeconds()).toBe("error");
  });
});

describe("isMissingTable", () => {
  it("recognizes only a missing PlayEvent table", () => {
    expect(isMissingTable({ code: "P2021" })).toBe(true);
    expect(isMissingTable(new Error('relation "PlayEvent" does not exist'))).toBe(true);
    expect(isMissingTable(new Error('relation "Other" does not exist'))).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});
