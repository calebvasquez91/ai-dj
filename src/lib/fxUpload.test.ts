import { afterEach, describe, expect, it, vi } from "vitest";

const blobUpload = vi.hoisted(() => vi.fn());
vi.mock("@vercel/blob/client", () => ({ upload: blobUpload }));

import { uploadFx } from "./fxUpload";

const file = new File([new Uint8Array([1, 2, 3])], "boo.wav", { type: "audio/wav" });
const fxResponse = { id: "fx1" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  blobUpload.mockReset();
});

function stubFetch() {
  const fn = vi.fn(async () => new Response(JSON.stringify(fxResponse), { status: 201 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("uploadFx request bodies", () => {
  it("local backend: sends the affinity as a JSON form field", async () => {
    vi.stubEnv("NEXT_PUBLIC_STORAGE_BACKEND", "local");
    const fetchFn = stubFetch();
    await uploadFx(file, { name: "boo", category: "effect", durationSec: 3, playlistAffinity: ["spooky", "halloween"] });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/fx");
    const form = init.body as FormData;
    expect(JSON.parse(form.get("playlistAffinity") as string)).toEqual(["spooky", "halloween"]);
    expect(form.get("category")).toBe("effect");
  });

  it("local backend: sends an empty affinity when none is given", async () => {
    vi.stubEnv("NEXT_PUBLIC_STORAGE_BACKEND", "local");
    const fetchFn = stubFetch();
    await uploadFx(file, { name: "boo", category: "effect", durationSec: 3 });
    const form = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(JSON.parse(form.get("playlistAffinity") as string)).toEqual([]);
  });

  it("blob backend: records the affinity in the metadata call after the direct upload", async () => {
    vi.stubEnv("NEXT_PUBLIC_STORAGE_BACKEND", "blob");
    blobUpload.mockResolvedValue({ url: "https://x.public.blob.vercel-storage.com/boo.wav" });
    const fetchFn = stubFetch();
    await uploadFx(file, { name: "boo", category: "transition", durationSec: 3, playlistAffinity: ["spooky", "halloween"] });
    expect(blobUpload).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/fx");
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: "boo",
      category: "transition",
      playlistAffinity: ["spooky", "halloween"],
      blobUrl: "https://x.public.blob.vercel-storage.com/boo.wav",
    });
  });

  it("throws the server's error message on a failed response", async () => {
    vi.stubEnv("NEXT_PUBLIC_STORAGE_BACKEND", "local");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 400 })));
    await expect(uploadFx(file, { name: "boo", category: "effect", durationSec: 3 })).rejects.toThrow("nope");
  });
});
