import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: "u-other",
  findUnique: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  save: vi.fn(),
  load: vi.fn(),
  deleteBlob: vi.fn(),
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
vi.mock("@/lib/trackUserData", () => ({ saveUserTrackData: mocks.save, loadUserTrackData: mocks.load }));

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
  for (const m of [mocks.findUnique, mocks.update, mocks.deleteMany, mocks.save, mocks.load, mocks.deleteBlob]) m.mockReset();
  mocks.findUnique.mockResolvedValue(song);
  mocks.update.mockImplementation(async ({ data }: { data: object }) => ({ ...song, ...data }));
  mocks.save.mockImplementation(async (_u: string, _t: string, p: object) => p);
  mocks.load.mockResolvedValue(new Map());
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.deleteBlob.mockResolvedValue(undefined);
});

describe("DELETE /api/tracks/[id]: only the admin takes a song out of the shared library", () => {
  it("refuses anyone else, and removes nothing", async () => {
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), ctx);
    expect(res.status).toBe(403);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
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
});

describe("PATCH /api/tracks/[id]: what is shared and what is each person's own", () => {
  it("keeps the must / do-not-play mark per person: saved for the caller, never written onto the shared song", async () => {
    const res = await PATCH(patch({ playPreference: "do-not" }), ctx);
    expect(res.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith("u-other", "t1", { playPreference: "do-not" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect((await res.json()).playPreference).toBe("do-not");
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
