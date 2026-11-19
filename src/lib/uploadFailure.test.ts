import { afterEach, describe, expect, it, vi } from "vitest";
import { explainBlobFailure } from "./uploadFailure";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(res: Response | Error) {
  const fn = vi.fn(async () => {
    if (res instanceof Error) throw res;
    return res;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("explainBlobFailure", () => {
  const tokenError = new Error("Vercel Blob: Failed to  retrieve the client token");

  it("replaces the storage client's generic token error with the server's reason when the daily limit was hit", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ error: "Upload limit reached: 300 files per 24 hours for this account. Try again later." }), { status: 429 }));
    const out = await explainBlobFailure(tokenError);
    expect(fetchFn).toHaveBeenCalledWith("/api/uploads/allowance");
    expect(out.message).toBe("Upload limit reached: 300 files per 24 hours for this account. Try again later.");
  });

  it("keeps the original error when the account is not over its limit (the refusal was something else)", async () => {
    stubFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(await explainBlobFailure(tokenError)).toBe(tokenError);
  });

  it("keeps the original error when the answer has no usable message or the check itself fails", async () => {
    stubFetch(new Response("not json", { status: 500 }));
    expect(await explainBlobFailure(tokenError)).toBe(tokenError);
    stubFetch(new Error("offline"));
    expect(await explainBlobFailure(tokenError)).toBe(tokenError);
  });

  it("does not ask at all for any other error", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 429 }));
    const other = new Error("The file is too large");
    expect(await explainBlobFailure(other)).toBe(other);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("wraps a thrown non-Error", async () => {
    const out = await explainBlobFailure("boom");
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toBe("boom");
  });
});
