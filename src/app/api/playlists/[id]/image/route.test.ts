import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: "u-owner",
  findPlaylist: vi.fn(),
  store: vi.fn(),
  remove: vi.fn(),
  event: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => (mocks.user ? { user: { id: mocks.user } } : null)) }));
vi.mock("@/lib/prisma", () => ({ prisma: { playlist: { findUnique: mocks.findPlaylist } } }));
vi.mock("@/lib/playlistImageServer", () => ({
  storePlaylistImage: mocks.store,
  removePlaylistImage: mocks.remove,
  isMissingTable: (e: unknown) => (e as { code?: string })?.code === "P2021",
}));
vi.mock("@/lib/telemetryServer", () => ({ recordAuditEvent: mocks.event, requestDeviceId: () => "dev-1" }));

import { DELETE, POST } from "./route";

const ctx = { params: Promise.resolve({ id: "p1" }) };
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2, 3]);
const upload = (bytes: Uint8Array, type: string) => {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], "pic", { type }));
  return POST(new Request("http://x/api/playlists/p1/image", { method: "POST", body: form }), ctx);
};
const remove = () => DELETE(new Request("http://x/api/playlists/p1/image", { method: "DELETE" }), ctx);

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_USER_IDS", "u-admin");
  vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
  mocks.user = "u-owner";
  mocks.findPlaylist.mockReset().mockResolvedValue({ id: "p1", userId: "u-owner", name: "Gym" });
  mocks.store.mockReset().mockResolvedValue("https://store.example/gym.jpg");
  mocks.remove.mockReset().mockResolvedValue(true);
  mocks.event.mockReset();
});

describe("POST /api/playlists/[id]/image", () => {
  it("lets the owner add a picture, stores it and logs it", async () => {
    const res = await upload(jpegBytes, "image/jpeg");
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ imageUrl: "https://store.example/gym.jpg" });
    expect(mocks.store).toHaveBeenCalledWith("p1", expect.any(Buffer), "image/jpeg");
    expect(mocks.event).toHaveBeenCalledWith({ eventType: "image_added", actorId: "u-owner", deviceId: "dev-1", targetId: "p1", targetLabel: "Gym" });
  });

  it("lets the admin do it on anyone's playlist", async () => {
    mocks.user = "u-admin";
    expect((await upload(jpegBytes, "image/jpeg")).status).toBe(201);
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ actorId: "u-admin" }));
  });

  it("is a 404 for another account, and for a signed-out visitor a 401, storing nothing", async () => {
    mocks.user = "u-other";
    expect((await upload(jpegBytes, "image/jpeg")).status).toBe(404);
    mocks.user = "";
    expect((await upload(jpegBytes, "image/jpeg")).status).toBe(401);
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("refuses a file that is not really a JPG, PNG or WebP, whatever it is called, and stores nothing", async () => {
    const script = new TextEncoder().encode("<svg><script>alert(1)</script></svg>");
    expect((await upload(script, "image/png")).status).toBe(400);
    expect((await upload(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0]), "image/gif")).status).toBe(400);
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("says so plainly (503) when the table is not there yet, instead of failing", async () => {
    mocks.store.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    const res = await upload(jpegBytes, "image/jpeg");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not set up/);
    expect(mocks.event).not.toHaveBeenCalled();
  });

  it("refuses a request with no file", async () => {
    const res = await POST(new Request("http://x", { method: "POST", body: new FormData() }), ctx);
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/playlists/[id]/image", () => {
  it("lets the owner remove it, and logs it", async () => {
    expect((await remove()).status).toBe(204);
    expect(mocks.remove).toHaveBeenCalledWith("p1");
    expect(mocks.event).toHaveBeenCalledWith({ eventType: "image_removed", actorId: "u-owner", deviceId: "dev-1", targetId: "p1", targetLabel: "Gym" });
  });
  it("logs nothing when there was no picture to remove", async () => {
    mocks.remove.mockResolvedValue(false);
    expect((await remove()).status).toBe(204);
    expect(mocks.event).not.toHaveBeenCalled();
  });
  it("is a quiet success when the table is not there (nothing to remove)", async () => {
    mocks.remove.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    expect((await remove()).status).toBe(204);
    expect(mocks.event).not.toHaveBeenCalled();
  });
  it("is a 404 for another account's playlist", async () => {
    mocks.user = "u-other";
    expect((await remove()).status).toBe(404);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
