import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: "u-other", findUnique: vi.fn(), update: vi.fn(), deleteMany: vi.fn() }));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: mocks.user } })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { fxSound: { findUnique: mocks.findUnique, update: mocks.update, deleteMany: mocks.deleteMany } },
}));
vi.mock("@/lib/storage", () => ({
  getStorageBackend: () => "blob",
  deleteLocalFile: vi.fn(async () => {}),
  deleteBlobFile: vi.fn(async () => {}),
}));

import { DELETE, PATCH } from "./route";

const fx = {
  id: "fx1",
  userId: "u-uploader",
  name: "Riser",
  fileName: "riser.mp3",
  storageKey: "https://x.public.blob.vercel-storage.com/riser.mp3",
  mimeType: "audio/mpeg",
  category: "effect",
  durationSec: 4,
  bpm: null,
  key: null,
  tagsJson: "[]",
  playlistAffinityJson: "[]",
  createdAt: new Date(0),
};
const ctx = { params: Promise.resolve({ id: "fx1" }) };
const patchName = (name: string) => new Request("http://x", { method: "PATCH", body: JSON.stringify({ name }) });

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_USER_IDS", "u-admin");
  vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
  mocks.user = "u-other";
  mocks.findUnique.mockReset().mockResolvedValue(fx);
  mocks.update.mockReset().mockImplementation(async ({ data }: { data: object }) => ({ ...fx, ...data }));
  mocks.deleteMany.mockReset().mockResolvedValue({ count: 1 });
});

describe("FX sounds are shared: only the admin changes or deletes one", () => {
  it("refuses an edit and a delete from anyone else, including whoever added the sound", async () => {
    for (const user of ["u-other", "u-uploader"]) {
      mocks.user = user;
      expect((await PATCH(patchName("x"), ctx)).status).toBe(403);
      expect((await DELETE(new Request("http://x", { method: "DELETE" }), ctx)).status).toBe(403);
    }
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("lets the admin edit and delete a sound somebody else added", async () => {
    mocks.user = "u-admin";
    expect((await PATCH(patchName("Big riser"), ctx)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "fx1" }, data: { name: "Big riser" } });
    expect((await DELETE(new Request("http://x", { method: "DELETE" }), ctx)).status).toBe(204);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: "fx1" } });
  });
});
