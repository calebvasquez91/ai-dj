import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  owner: true,
  findUnique: vi.fn(),
  update: vi.fn(),
  record: vi.fn(),
}));
vi.mock("@/lib/feedbackOwner", () => ({ feedbackOwnerSession: vi.fn(async () => (mocks.owner ? { user: { id: "u-admin" } } : null)) }));
vi.mock("@/lib/prisma", () => ({ prisma: { track: { findUnique: mocks.findUnique, update: mocks.update } } }));
vi.mock("@/lib/adminAudit", () => ({ recordAdminLibraryEdit: mocks.record }));

import { PATCH } from "./route";

const patch = (body: unknown, id = "t1") =>
  PATCH(new Request(`http://x/api/admin/music/${id}`, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const before = { id: "t1", artist: "", title: "Bidi", userId: "u-other", bpm: null, key: null, tagsJson: null };
const after = { id: "t1", artist: "Selena", title: "Bidi", bpm: null, key: null, camelotKey: null, tagsJson: null, durationSec: 100, createdAt: new Date("2026-11-19T00:00:00Z"), genreInfo: null, _count: { playEvents: 0 } };

beforeEach(() => {
  mocks.owner = true;
  mocks.findUnique.mockReset().mockResolvedValue(before);
  mocks.update.mockReset().mockResolvedValue(after);
  mocks.record.mockReset().mockResolvedValue(undefined);
});

describe("PATCH /api/admin/music/[id]", () => {
  it("does not exist for anyone but the admin, and changes nothing", async () => {
    mocks.owner = false;
    expect((await patch({ artist: "x" })).status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("saves the edit, logs it with the old values, and returns the new row", async () => {
    const res = await patch({ artist: "Selena", userId: "hijack" });
    expect(res.status).toBe(200);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ where: { id: "t1" }, data: { artist: "Selena" } });
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("userId");
    expect(mocks.record).toHaveBeenCalledWith({ actorId: "u-admin", track: before, changed: { artist: "Selena" } });
    expect(await res.json()).toMatchObject({ id: "t1", artist: "Selena" });
  });

  it("refuses a bad edit before touching the database", async () => {
    expect((await patch({ bpm: 5 })).status).toBe(400);
    expect((await patch("not json")).status).toBe(400);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("is a 404 for a song that is gone", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect((await patch({ artist: "x" })).status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
