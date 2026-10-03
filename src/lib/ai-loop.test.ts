import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_LOOP_CANDIDATES,
  pickFallbackLoop,
  pickLoopWithAI,
  sanitizeLoopRequest,
  type AiLoopCandidate,
  type AiLoopTrackProfile,
} from "./ai-loop";

const loops: AiLoopCandidate[] = [
  { id: "a", name: "Organ Drone", durationSec: 30 },
  { id: "b", name: "Wind Howl", durationSec: 20 },
  { id: "c", name: "Heartbeat", durationSec: 12 },
];
const track: AiLoopTrackProfile = { title: "Monster Mash", bpm: 120, camelotKey: "8A", mood: "spooky" };

describe("pickFallbackLoop", () => {
  it("never repeats the previous loop when others exist", () => {
    for (let i = 0; i < 50; i++) {
      expect(pickFallbackLoop(loops, "b").fxId).not.toBe("b");
    }
  });

  it("uses the injected random to choose among the rest", () => {
    expect(pickFallbackLoop(loops, "a", () => 0).fxId).toBe("b");
    expect(pickFallbackLoop(loops, "a", () => 0.99).fxId).toBe("c");
  });

  it("repeats the only loop rather than returning nothing", () => {
    expect(pickFallbackLoop([loops[0]], "a").fxId).toBe("a");
  });

  it("returns a null fxId for an empty list", () => {
    expect(pickFallbackLoop([], null).fxId).toBeNull();
  });
});

describe("pickLoopWithAI", () => {
  const realKey = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
  });

  function stubClaude(text: string, ok = true) {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok,
        status: ok ? 200 : 500,
        text: async () => "",
        json: async () => ({ content: [{ type: "text", text }] }),
      })
    );
  }

  it("falls back without calling the API when there is no key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await pickLoopWithAI(track, loops, "a");
    expect(result.usedFallback).toBe(true);
    expect(result.fxId).not.toBe("a");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns Claude's pick, parsing a fenced JSON answer", async () => {
    stubClaude('```json\n{"fxId":"c","reason":"heartbeat suits it"}\n```');
    const result = await pickLoopWithAI(track, loops, "a");
    expect(result).toEqual({ fxId: "c", reason: "heartbeat suits it", usedFallback: false });
  });

  it("falls back when Claude picks an id that isn't a candidate", async () => {
    stubClaude('{"fxId":"zzz","reason":"?"}');
    const result = await pickLoopWithAI(track, loops, "a");
    expect(result.usedFallback).toBe(true);
    expect(loops.map((l) => l.id)).toContain(result.fxId);
  });

  it("falls back when Claude repeats the previous loop but others exist", async () => {
    stubClaude('{"fxId":"a","reason":"again"}');
    const result = await pickLoopWithAI(track, loops, "a");
    expect(result.usedFallback).toBe(true);
    expect(result.fxId).not.toBe("a");
  });

  it("falls back on a non-OK response and on a thrown error", async () => {
    stubClaude("{}", false);
    expect((await pickLoopWithAI(track, loops, null)).usedFallback).toBe(true);
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect((await pickLoopWithAI(track, loops, null)).usedFallback).toBe(true);
  });
});

describe("sanitizeLoopRequest", () => {
  const valid = { currentTrack: { title: "Monster Mash", bpm: 120, camelotKey: "8A", mood: "spooky" }, availableLoops: loops, previousLoopId: "a" };

  it("passes a valid request through", () => {
    expect(sanitizeLoopRequest(valid)).toEqual(valid);
  });

  it("rejects bodies without a track title or a loops array", () => {
    expect(sanitizeLoopRequest(null)).toBeNull();
    expect(sanitizeLoopRequest("x")).toBeNull();
    expect(sanitizeLoopRequest({ ...valid, currentTrack: { bpm: 1 } })).toBeNull();
    expect(sanitizeLoopRequest({ ...valid, availableLoops: "nope" })).toBeNull();
  });

  it("caps the number of loops", () => {
    const many = Array.from({ length: MAX_LOOP_CANDIDATES + 40 }, (_, i) => ({ id: `l${i}`, name: "n", durationSec: 5 }));
    expect(sanitizeLoopRequest({ ...valid, availableLoops: many })?.availableLoops).toHaveLength(MAX_LOOP_CANDIDATES);
  });

  it("clips long strings and drops malformed loops", () => {
    const long = "x".repeat(5000);
    const out = sanitizeLoopRequest({
      currentTrack: { title: long, mood: long, camelotKey: long, bpm: "fast" },
      availableLoops: [{ id: "ok", name: long, durationSec: "12" }, { id: 7 }, null, { id: long }],
      previousLoopId: long,
    });
    expect(out?.currentTrack.title).toHaveLength(200);
    expect(out?.currentTrack.mood).toHaveLength(200);
    expect(out?.currentTrack.camelotKey).toHaveLength(8);
    expect(out?.currentTrack.bpm).toBeNull();
    expect(out?.availableLoops).toEqual([{ id: "ok", name: "x".repeat(200), durationSec: 0 }]);
    expect(out?.previousLoopId).toBeNull();
  });
});
