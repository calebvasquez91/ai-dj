import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deviceFindMany: vi.fn(),
  deviceCount: vi.fn(),
  userFindMany: vi.fn(),
  auditFindMany: vi.fn(),
  uploadFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  queryRaw: vi.fn(),
  trackCount: vi.fn(),
  playlistCount: vi.fn(),
  playAggregate: vi.fn(),
  genreJobGroup: vi.fn(),
  stemJobGroup: vi.fn(),
  list: vi.fn(),
  trackGenreFindMany: vi.fn(),
  trackGenreCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    device: { findMany: mocks.deviceFindMany, count: mocks.deviceCount },
    user: { findMany: mocks.userFindMany },
    auditEvent: { findMany: mocks.auditFindMany },
    uploadRecord: { findMany: mocks.uploadFindMany },
    appSession: { findMany: mocks.sessionFindMany },
    track: { count: mocks.trackCount },
    playlist: { count: mocks.playlistCount },
    playEvent: { aggregate: mocks.playAggregate },
    trackGenre: { findMany: mocks.trackGenreFindMany, count: mocks.trackGenreCount },
    genreJob: { groupBy: mocks.genreJobGroup },
    stemSeparationJob: { groupBy: mocks.stemJobGroup },
    $queryRaw: mocks.queryRaw,
  },
}));
vi.mock("@vercel/blob", () => ({ list: mocks.list }));

import { BLOB_SIZE_CACHE_MS, exportRows, loadAuditLog, loadDevices, loadGenreCounts, loadHealth, loadOverview, loadPlaytime, resetBlobSizeCache } from "./activityServer";
import type { ActivityFilter } from "./activity";

const NO_FILTER: ActivityFilter = { from: null, to: null, type: null };
const now = Date.UTC(2026, 10, 19, 12, 0, 0);

beforeEach(() => {
  vi.unstubAllEnvs();
  for (const m of Object.values(mocks)) m.mockReset();
  resetBlobSizeCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadDevices", () => {
  it("marks a device active only when it was heard from in the last 75 seconds, and names its last account", async () => {
    mocks.deviceFindMany.mockResolvedValue([
      { id: "d1", platform: "web", os: "Windows", appVersion: "2.0.0", lastUserId: "u1", firstSeenAt: new Date(now - 9e6), lastSeenAt: new Date(now - 30_000) },
      { id: "d2", platform: "web", os: "iOS", appVersion: "2.0.0", lastUserId: null, firstSeenAt: new Date(now - 9e6), lastSeenAt: new Date(now - 76_000) },
    ]);
    mocks.userFindMany.mockResolvedValue([{ id: "u1", email: "a@x.com", name: "Ann" }]);
    const r = await loadDevices(now);
    expect(r.ok && r.data.map((d) => [d.id, d.activeNow, d.account])).toEqual([["d1", true, "Ann (a@x.com)"], ["d2", false, "—"]]);
  });
  it("says no-table (not an error) when the tables are not there yet", async () => {
    mocks.deviceFindMany.mockRejectedValue(Object.assign(new Error("missing"), { code: "P2021" }));
    expect(await loadDevices(now)).toEqual({ ok: false, reason: "no-table" });
  });
  it("says error for any other failure, so a hiccup is not mistaken for missing setup", async () => {
    mocks.deviceFindMany.mockRejectedValue(new Error("connection refused"));
    expect(await loadDevices(now)).toEqual({ ok: false, reason: "error" });
  });
});

describe("loadAuditLog: the date range and event type go to the database", () => {
  it("filters by both bounds and the event type, newest first", async () => {
    mocks.auditFindMany.mockResolvedValue([]);
    const from = new Date("2026-11-01T00:00:00Z");
    const to = new Date("2026-11-19T23:59:59.999Z");
    await loadAuditLog({ from, to, type: "song_removed" });
    expect(mocks.auditFindMany).toHaveBeenCalledWith({ where: { createdAt: { gte: from, lte: to }, eventType: "song_removed" }, orderBy: { createdAt: "desc" }, take: 300 });
  });
  it("adds no filter when none is set", async () => {
    mocks.auditFindMany.mockResolvedValue([]);
    await loadAuditLog(NO_FILTER);
    expect(mocks.auditFindMany.mock.calls[0][0].where).toEqual({});
  });
  it("shows a song's label, falling back to its id", async () => {
    mocks.auditFindMany.mockResolvedValue([
      { createdAt: new Date(now), eventType: "song_added", actorRole: "user", deviceId: "d1", targetLabel: "A - B", targetId: "t1" },
      { createdAt: new Date(now), eventType: "song_removed", actorRole: "admin", deviceId: null, targetLabel: null, targetId: "t2" },
    ]);
    const r = await loadAuditLog(NO_FILTER);
    expect(r.ok && r.data.map((x) => x.label)).toEqual(["A - B", "t2"]);
  });
});

describe("loadPlaytime: summed in the database", () => {
  it("reads the day and week totals as grouped rows, keeping the last 14 days and 8 weeks, and the average session", async () => {
    const days = Array.from({ length: 20 }, (_, i) => ({ key: `2026-11-${String(i + 1).padStart(2, "0")}`, seconds: i + 1 }));
    const weeks = Array.from({ length: 10 }, (_, i) => ({ key: `week-${i}`, seconds: (i + 1) * 100 }));
    mocks.queryRaw.mockResolvedValueOnce(days).mockResolvedValueOnce(weeks);
    mocks.sessionFindMany.mockResolvedValue([{ startedAt: new Date(0), lastBeatAt: new Date(60_000) }, { startedAt: new Date(0), lastBeatAt: new Date(120_000) }]);
    const r = await loadPlaytime(now);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(r.ok && r.data.perDay).toHaveLength(14);
    expect(r.ok && r.data.perDay.at(-1)).toEqual({ key: "2026-11-20", seconds: 20 });
    expect(r.ok && r.data.perWeek).toHaveLength(8);
    expect(r.ok && r.data.averageSessionSeconds).toBe(90);
    expect(mocks.sessionFindMany.mock.calls[0][0].where.startedAt.gte.getTime()).toBe(now - 30 * 86_400_000);
  });
  it("still answers when the sessions table is missing", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.sessionFindMany.mockRejectedValue(new Error("no table"));
    const r = await loadPlaytime(now);
    expect(r.ok && r.data.averageSessionSeconds).toBeNull();
  });
});

describe("loadGenreCounts: both counts per genre", () => {
  it("reads each song's genre and tags once, and returns main and tagged counts with the review and unclassified totals", async () => {
    const t = (genre: string) => ({ genre, source: "file-tags", confidence: 0.9, updatedAt: 0 });
    mocks.trackGenreFindMany.mockResolvedValue([
      { genre: "Pop", tagsJson: JSON.stringify([t("Pop"), t("Soul")]) },
      { genre: "Pop", tagsJson: JSON.stringify([t("Pop")]) },
    ]);
    mocks.trackGenreCount.mockResolvedValueOnce(4).mockResolvedValueOnce(2); // needs review, classified
    mocks.trackCount.mockResolvedValue(10);
    const r = await loadGenreCounts();
    expect(mocks.trackGenreFindMany).toHaveBeenCalledTimes(1);
    expect(r.ok && r.data).toEqual({
      genres: [{ genre: "Pop", main: 2, tagged: 2 }, { genre: "Soul", main: 0, tagged: 1 }],
      needsReview: 4,
      unclassified: 8,
    });
  });
  it("says no-table when the genre table is missing", async () => {
    mocks.trackGenreFindMany.mockRejectedValue(Object.assign(new Error("missing"), { code: "P2021" }));
    mocks.trackGenreCount.mockResolvedValue(0);
    mocks.trackCount.mockResolvedValue(0);
    expect(await loadGenreCounts()).toEqual({ ok: false, reason: "no-table" });
  });
});

describe("loadOverview", () => {
  it("keeps the totals it can read when one table is missing", async () => {
    mocks.trackCount.mockResolvedValue(3450);
    mocks.playlistCount.mockResolvedValue(12);
    mocks.deviceCount.mockRejectedValue(new Error("no table"));
    mocks.playAggregate.mockResolvedValue({ _sum: { seconds: 7200 } });
    const r = await loadOverview(now);
    expect(r.ok && r.data).toEqual({ tracks: 3450, playlists: 12, devices: null, activeNow: null, totalPlaySeconds: 7200 });
  });
});

describe("loadHealth: the file store is listed once per ten minutes", () => {
  function setup() {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token");
    mocks.list.mockResolvedValue({ blobs: [{ size: 1000 }, { size: 500 }], hasMore: false });
    mocks.queryRaw.mockResolvedValue([{ bytes: BigInt(4096) }]);
    mocks.genreJobGroup.mockResolvedValue([{ status: "queued", _count: { _all: 3 } }, { status: "failed", _count: { _all: 1 } }]);
    mocks.stemJobGroup.mockResolvedValue([{ status: "processing", _count: { _all: 2 } }]);
    mocks.trackCount.mockResolvedValue(900);
  }
  it("adds up every file, reports the queues and the failures, and uses the limits in the settings", async () => {
    setup();
    vi.stubEnv("ADMIN_BLOB_LIMIT_GB", "1");
    const r = await loadHealth();
    expect(r.ok && r.data.storage).toEqual({ usedBytes: 1500, limitBytes: 1024 ** 3 });
    expect(r.ok && r.data.database).toEqual({ usedBytes: 4096, limitBytes: null });
    expect(r.ok && r.data.queues).toEqual([
      { kind: "Genre classification", waiting: 3, running: 0, failed: 1 },
      { kind: "Stem separation", waiting: 0, running: 2, failed: 0 },
    ]);
    expect(r.ok && r.data.unanalysed).toBe(900);
  });
  it("does not list the file store again within ten minutes", async () => {
    setup();
    await loadHealth();
    await loadHealth();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(BLOB_SIZE_CACHE_MS).toBe(600_000);
  });
  it("shows no file storage figure without the storage token", async () => {
    setup();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const r = await loadHealth();
    expect(r.ok && r.data.storage).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

describe("exportRows", () => {
  it("exports the three tables, and nothing for an unknown kind", async () => {
    mocks.auditFindMany.mockResolvedValue([{ createdAt: new Date(now), eventType: "song_added", actorRole: "user", deviceId: "d1", targetLabel: "A - B", targetId: "t" }]);
    mocks.uploadFindMany.mockResolvedValue([]);
    mocks.deviceFindMany.mockResolvedValue([]);
    mocks.userFindMany.mockResolvedValue([]);
    expect((await exportRows("audit", NO_FILTER))?.columns).toEqual(["when_utc", "event", "role", "device", "target"]);
    expect((await exportRows("uploads", NO_FILTER))?.columns).toEqual(["when_utc", "device", "account", "song"]);
    expect((await exportRows("devices", NO_FILTER))?.columns[0]).toBe("device");
    expect(await exportRows("nope", NO_FILTER)).toBeNull();
  });
  it("is null when the table is missing", async () => {
    mocks.auditFindMany.mockRejectedValue(Object.assign(new Error("x"), { code: "P2021" }));
    expect(await exportRows("audit", NO_FILTER)).toBeNull();
  });
});
