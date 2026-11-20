import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  owner: true,
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  record: vi.fn(),
}));
vi.mock("@/lib/feedbackOwner", () => ({ feedbackOwnerSession: vi.fn(async () => (mocks.owner ? { user: { id: "u-admin" } } : null)) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    track: { findUnique: mocks.findUnique, update: mocks.update },
    playEvent: { updateMany: mocks.updateMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/adminAudit", () => ({ recordAdminLibraryEdit: mocks.record }));

import { PATCH } from "./route";

const patch = (body: unknown, id = "t1") =>
  PATCH(new Request(`http://x/api/admin/music/${id}`, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const before = { id: "t1", artist: "Unknown Artist", title: "Bidi", userId: "u-other", bpm: null, key: null, tagsJson: null };
const after = { id: "t1", artist: "Selena", title: "Bidi", bpm: null, key: null, camelotKey: null, tagsJson: null, durationSec: 100, createdAt: new Date("2026-11-19T00:00:00Z"), genreInfo: null, _count: { playEvents: 0 } };

beforeEach(() => {
  mocks.owner = true;
  mocks.findUnique.mockReset().mockResolvedValue(before);
  mocks.update.mockReset().mockImplementation((args: unknown) => ({ op: "track.update", args }));
  mocks.updateMany.mockReset().mockImplementation((args: unknown) => ({ op: "playEvent.updateMany", args }));
  // The transaction gets the operations (here plain descriptions) and answers with each one's result: the updated song first.
  mocks.transaction.mockReset().mockImplementation(async (ops: unknown[]) => [after, ...ops.slice(1).map(() => ({ count: 3 }))]);
  mocks.record.mockReset().mockResolvedValue(undefined);
});

describe("PATCH /api/admin/music/[id]", () => {
  it("does not exist for anyone but the admin, and changes nothing", async () => {
    mocks.owner = false;
    expect((await patch({ artist: "x" })).status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("saves the edit, logs it with the old values, and returns the new row", async () => {
    const res = await patch({ artist: "Selena", userId: "hijack" });
    expect(res.status).toBe(200);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ where: { id: "t1" }, data: { artist: "Selena" } });
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("userId");
    expect(mocks.record).toHaveBeenCalledWith({ actorId: "u-admin", track: before, changed: { artist: "Selena" } });
    expect(await res.json()).toMatchObject({ id: "t1", artist: "Selena" });
  });

  it("puts a rename onto the song's play history in the same transaction, so the listening stats do not list it twice", async () => {
    await patch({ artist: "Selena", title: "Bidi Bidi Bom Bom" });
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { trackId: "t1" }, data: { artist: "Selena", title: "Bidi Bidi Bom Bom" } });
    expect(mocks.transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("leaves the play history alone for an edit that is not a rename", async () => {
    await patch({ tags: ["latin"] });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction.mock.calls[0][0]).toHaveLength(1);
  });

  it("refuses a BPM or key for a song the app has not analysed yet, and changes nothing", async () => {
    for (const body of [{ bpm: 128 }, { key: "A minor" }, { key: null }]) {
      const res = await patch(body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect((await res.json()).error).toContain("not been analysed");
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("saves a BPM and key for an analysed song and marks them as set by hand", async () => {
    mocks.findUnique.mockResolvedValue({ ...before, bpm: 60 });
    const res = await patch({ bpm: 120.456, key: "Am" });
    expect(res.status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toEqual({ bpm: 120.46, key: "A minor", camelotKey: "8A", bpmSource: "manual" });
  });

  it("does not mark the song as set by hand for an edit to the name or tags", async () => {
    mocks.findUnique.mockResolvedValue({ ...before, bpm: 60 });
    await patch({ artist: "Selena", tags: ["latin"] });
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("bpmSource");
  });

  it("refuses a bad edit before touching the database", async () => {
    expect((await patch({ bpm: 5 })).status).toBe(400);
    expect((await patch({ bpm: null })).status).toBe(400);
    expect((await patch("not json")).status).toBe(400);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("is a 404 for a song that is gone", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect((await patch({ artist: "x" })).status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
