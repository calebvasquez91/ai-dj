import { afterEach, describe, expect, it, vi } from "vitest";
import { requestLoopPick } from "./loopApi";

const track = { title: "Monster Mash", bpm: 120, camelotKey: "8A", mood: null };
const loops = [
  { id: "a", name: "Organ", durationSec: 30 },
  { id: "b", name: "Wind", durationSec: 20 },
  { id: "c", name: "Heartbeat", durationSec: 12 },
];

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: () => Promise<unknown>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("requestLoopPick", () => {
  it("returns null for no loops without calling the API", async () => {
    const fn = stubFetch(async () => ({}));
    expect(await requestLoopPick(track, [], null)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns the only loop without calling the API", async () => {
    const fn = stubFetch(async () => ({}));
    expect(await requestLoopPick(track, [loops[0]], "a")).toBe("a");
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns the id the API picked", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ fxId: "c" }) }));
    expect(await requestLoopPick(track, loops, "a")).toBe("c");
  });

  it("falls back (never the previous loop) on a non-OK response", async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    for (let i = 0; i < 20; i++) expect(await requestLoopPick(track, loops, "b")).not.toBe("b");
  });

  it("falls back when the API names a loop that isn't a candidate", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ fxId: "zzz" }) }));
    expect(["a", "b", "c"]).toContain(await requestLoopPick(track, loops, null));
  });

  it("falls back when the request rejects or times out", async () => {
    stubFetch(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect(["a", "c"]).toContain(await requestLoopPick(track, loops, "b"));
  });
});
