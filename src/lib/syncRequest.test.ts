import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonInit, syncRequest } from "@/lib/syncRequest";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("syncRequest", () => {
  it("reports success for a 2xx", async () => {
    stubFetch(async () => new Response(null, { status: 204 }));
    expect(await syncRequest("/x", { method: "DELETE" })).toEqual({ ok: true, status: 204, error: "" });
  });

  it("uses the server's JSON error message when there is one", async () => {
    stubFetch(async () => Response.json({ error: "Name is required." }, { status: 400 }));
    const r = await syncRequest("/x");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toBe("Name is required.");
  });

  it("falls back to a status-specific message for an empty body", async () => {
    stubFetch(async () => new Response(null, { status: 500 }));
    const r = await syncRequest("/x");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/server had a problem/i);

    stubFetch(async () => new Response(null, { status: 401 }));
    expect((await syncRequest("/x")).error).toMatch(/sign in/i);
  });

  it("falls back for a non-JSON body (e.g. a proxy error page)", async () => {
    stubFetch(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    const r = await syncRequest("/x");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/server had a problem/i);
  });

  it("never throws on a network failure — status 0", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const r = await syncRequest("/x");
    expect(r).toMatchObject({ ok: false, status: 0 });
    expect(r.error).toMatch(/connection/i);
  });

  it("treats opted-in statuses as success (404 on DELETE)", async () => {
    stubFetch(async () => new Response(null, { status: 404 }));
    expect((await syncRequest("/x", { method: "DELETE" })).ok).toBe(false);
    expect((await syncRequest("/x", { method: "DELETE" }, { okStatuses: [404] })).ok).toBe(true);
  });

  it("ignores a JSON body whose error is not a string", async () => {
    stubFetch(async () => Response.json({ error: { nested: true } }, { status: 409 }));
    expect((await syncRequest("/x")).error).toMatch(/conflicts/i);
  });
});

describe("jsonInit", () => {
  it("builds a JSON request", () => {
    const init = jsonInit("PATCH", { a: 1 });
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });
});
