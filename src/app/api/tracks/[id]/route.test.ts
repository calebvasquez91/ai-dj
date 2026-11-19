import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: "u-other",
  findUnique: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  save: vi.fn(),
  loadOne: vi.fn(),
  deleteBlob: vi.fn(),
  audit: vi.fn(),
  event: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: mocks.user } })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    track: { findUnique: mocks.findUnique, update: mocks.update, deleteMany: mocks.deleteMany },
    stemSeparationJob: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/storage", () => ({
  getStorageBackend: () => "blob",
  deleteLocalFile: vi.fn(async () => {}),
  deleteBlobFile: mocks.deleteBlob,
}));
vi.mock("@/lib/adminAudit", () => ({ recordAdminLibraryDelete: mocks.audit }));
vi.mock("@/lib/telemetryServer", () => ({ recordAuditEvent: mocks.event, requestDeviceId: () => "dev-1" }));
vi.mock("@/lib/trackUserData", () => ({ saveUserTrackData: mocks.save, loadOneUserTrackData: mocks.loadOne }));

import { DELETE, PATCH } from "./route";

const song = {
  id: "t1",
  userId: "u-uploader", // somebody else's upload: the library is shared
  title: "Song",
  artist: "Artist",
  durationSec: 200,
  source: "local",
  storageKey: "https://x.public.blob.vercel-storage.com/song.mp3",
  mimeType: "audio/mpeg",
  thumbnailUrl: null,
  playPreference: null,
  createdAt: new Date(0),
  hotCueOverridesJson: null,
  tagsJson: null,
  bpm: null,
  bpmSource: null,
  buildDropPairsJson: null,
  waveformPeaksJson: null,
  lyricalFingerprintJson: null,
};
const ctx = { params: Promise.resolve({ id: "t1" }) };
const patch = (body: unknown) => new Request("http://x/api/tracks/t1", { method: "PATCH", body: JSON.stringify(body) });

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_USER_IDS", "u-admin");
  vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
  mocks.user = "u-other";
  for (const m of [mocks.findUnique, mocks.update, mocks.deleteMany, mocks.save, mocks.loadOne, mocks.deleteBlob, mocks.audit, mocks.event]) m.mockReset();
  mocks.findUnique.mockResolvedValue(song);
  mocks.update.mockImplementation(async ({ data }: { data: object }) => ({ ...song, ...data }));
  mocks.save.mockImplementation(async (_u: string, _t: string, p: object) => p);
  mocks.loadOne.mockResolvedValue(undefined);
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.deleteBlob.mockResolvedValue(undefined);
});

describe("DELETE /api/tracks/[id]: only the admin takes a song out of the shared library", () => {
  it("refuses anyone else, and removes nothing", async () => {
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), ctx);
    expect(res.status).toBe(403);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("refuses the person who uploaded it too", async () => {
    mocks.user = "u-uploader";
    expect((await DELETE(new Request("http://x", { method: "DELETE" }), ctx)).status).toBe(403);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("lets the admin delete a song somebody else added, and its file", async () => {
    mocks.user = "u-admin";
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), ctx);
    expect(res.status).toBe(204);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: "t1" } });
    expect(mocks.deleteBlob).toHaveBeenCalledWith(song.storageKey);
  });

  it("logs the admin's deletion (who, and which song)", async () => {
    mocks.user = "u-admin";
    await DELETE(new Request("http://x", { method: "DELETE" }), ctx);
    expect(mocks.audit).toHaveBeenCalledWith({ actorId: "u-admin", track: expect.objectContaining({ id: "t1", title: "Song", artist: "Artist", userId: "u-uploader" }) });
  });

  it("writes a song_removed line in the audit log with the admin's role and device", async () => {
    mocks.user = "u-admin";
    await DELETE(new Request("http://x", { method: "DELETE" }), ctx);
    expect(mocks.event).toHaveBeenCalledWith({ eventType: "song_removed", actorId: "u-admin", deviceId: "dev-1", targetId: "t1", targetLabel: "Artist - Song" });
  });

  it("writes no audit line when the request is refused", async () => {
    await DELETE(new Request("http://x", { method: "DELETE" }), ctx);
    expect(mocks.event).not.toHaveBeenCalled();
  });

  it("does not log a deletion that another request already made", async () => {
    mocks.user = "u-admin";
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    await DELETE(new Request("http://x", { method: "DELETE" }), ctx);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/tracks/[id]: what is shared and what is each person's own", () => {
  it("keeps the must mark per person: saved for the caller, never written onto the shared song", async () => {
    const res = await PATCH(patch({ playPreference: "must" }), ctx);
    expect(res.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith("u-other", "t1", { playPreference: "must" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect((await res.json()).playPreference).toBe("must");
  });

  it("refuses the do-not-play mark from anyone but the admin, and saves nothing", async () => {
    const res = await PATCH(patch({ playPreference: "do-not" }), ctx);
    expect(res.status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("lets anyone clear a mark, and lets the admin set do-not-play", async () => {
    expect((await PATCH(patch({ playPreference: null }), ctx)).status).toBe(200);
    expect(mocks.save).toHaveBeenLastCalledWith("u-other", "t1", { playPreference: null });
    mocks.user = "u-admin";
    expect((await PATCH(patch({ playPreference: "do-not" }), ctx)).status).toBe(200);
    expect(mocks.save).toHaveBeenLastCalledWith("u-admin", "t1", { playPreference: "do-not" });
  });

  it("reads back the caller's own single row when the request only caches analysis", async () => {
    mocks.loadOne.mockResolvedValue({ playPreference: "must" });
    const res = await PATCH(patch({ analysis: { key: "C" } }), ctx);
    expect(mocks.loadOne).toHaveBeenCalledWith("u-other", "t1");
    expect((await res.json()).playPreference).toBe("must");
  });

  it("keeps hot cues per person too", async () => {
    await PATCH(patch({ hotCueOverrides: { "1": 12.5, "9": 3 } }), ctx);
    expect(mocks.save).toHaveBeenCalledWith("u-other", "t1", { hotCueOverridesJson: JSON.stringify({ "1": 12.5 }) });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("lets anyone cache the analysis of a song: it is the same for everybody", async () => {
    const res = await PATCH(patch({ analysis: { bpm: 128 } }), ctx);
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { bpm: 128 } });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("fills an empty analysis field for anyone, but never overwrites one that is already set (first write wins)", async () => {
    mocks.findUnique.mockResolvedValue({ ...song, bpm: 120, bpmConfidence: 0.9, key: null });
    const res = await PATCH(patch({ analysis: { bpm: 60, bpmConfidence: 0.1, key: "C" } }), ctx);
    expect(res.status).toBe(200);
    // bpm and bpmConfidence were already worked out: only the empty key is written.
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { key: "C" } });
  });

  it("answers 200 and writes nothing when everything sent is already set", async () => {
    mocks.findUnique.mockResolvedValue({ ...song, bpm: 120, lyricalFingerprintJson: '{"words":[],"moodTags":[]}' });
    const res = await PATCH(patch({ analysis: { bpm: 1 }, lyricalFingerprint: null }), ctx);
    expect(res.status).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
    expect((await res.json()).analysis.bpm).toBe(120);
  });

  it("lets the admin overwrite the analysis", async () => {
    mocks.user = "u-admin";
    mocks.findUnique.mockResolvedValue({ ...song, bpm: 120 });
    await PATCH(patch({ analysis: { bpm: 126 } }), ctx);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { bpm: 126 } });
  });

  it("refuses tags from anyone but the admin (they decide what is in Spooky Music for everybody)", async () => {
    const res = await PATCH(patch({ tags: ["halloween"] }), ctx);
    expect(res.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("lets the admin set tags", async () => {
    mocks.user = "u-admin";
    const res = await PATCH(patch({ tags: ["Halloween"] }), ctx);
    expect(res.status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data.tagsJson).toBe(JSON.stringify(["Halloween"]));
  });

  it("is a 404 for a song that does not exist, and a 400 for nothing to change", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    expect((await PATCH(patch({ playPreference: "must" }), ctx)).status).toBe(404);
    expect((await PATCH(patch({ nonsense: 1 }), ctx)).status).toBe(400);
  });
});
