import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backend: "local" as "local" | "blob",
  create: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/prisma", () => ({ prisma: { fxSound: { create: mocks.create, findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/storage", () => ({
  getStorageBackend: () => mocks.backend,
  saveLocalFile: vi.fn(async (id: string) => id),
  deleteLocalFile: vi.fn(async () => {}),
  deleteBlobFile: vi.fn(async () => {}),
}));

import { POST } from "./route";

beforeEach(() => {
  mocks.create.mockReset();
  mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "fx1",
    userId: "u1",
    bpm: null,
    key: null,
    tagsJson: "[]",
    createdAt: new Date(0),
    ...data,
  }));
});

describe("POST /api/fx playlist affinity", () => {
  it("multipart (local backend): stores the affinity from the form field", async () => {
    mocks.backend = "local";
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1])], "boo.wav", { type: "audio/wav" }));
    form.append("name", "boo");
    form.append("category", "effect");
    form.append("durationSec", "3");
    form.append("playlistAffinity", JSON.stringify(["spooky", "halloween"]));
    const res = await POST(new Request("http://x/api/fx", { method: "POST", body: form }));
    expect(res.status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data.playlistAffinityJson).toBe(JSON.stringify(["spooky", "halloween"]));
    expect((await res.json()).playlistAffinity).toEqual(["spooky", "halloween"]);
  });

  it("multipart: a missing or malformed affinity field is stored as none, not an error", async () => {
    mocks.backend = "local";
    for (const field of [undefined, "not json", '{"a":1}']) {
      mocks.create.mockClear();
      const form = new FormData();
      form.append("file", new File([new Uint8Array([1])], "boo.wav", { type: "audio/wav" }));
      form.append("name", "boo");
      form.append("category", "effect");
      form.append("durationSec", "3");
      if (field !== undefined) form.append("playlistAffinity", field);
      const res = await POST(new Request("http://x/api/fx", { method: "POST", body: form }));
      expect(res.status).toBe(201);
      expect(mocks.create.mock.calls[0][0].data.playlistAffinityJson).toBe("[]");
    }
  });

  it("JSON (blob backend): stores the affinity array from the body", async () => {
    mocks.backend = "blob";
    const res = await POST(
      new Request("http://x/api/fx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "boo",
          fileName: "boo.wav",
          category: "transition",
          durationSec: 3,
          blobUrl: "https://x.public.blob.vercel-storage.com/boo.wav",
          mimeType: "audio/wav",
          playlistAffinity: ["spooky", "Halloween", "spooky", 7],
        }),
      })
    );
    expect(res.status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data.playlistAffinityJson).toBe(JSON.stringify(["spooky", "Halloween"]));
  });

  it("JSON: omitting the affinity stores none", async () => {
    mocks.backend = "blob";
    const res = await POST(
      new Request("http://x/api/fx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "boo",
          fileName: "boo.wav",
          category: "effect",
          durationSec: 3,
          blobUrl: "https://x.public.blob.vercel-storage.com/boo.wav",
        }),
      })
    );
    expect(res.status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data.playlistAffinityJson).toBe("[]");
  });
});
