import { describe, expect, it, vi, afterEach } from "vitest";
import {
  pickFallbackTransitionFx,
  pickTransitionFxWithAI,
  MAX_FX_VOLUME_MULTIPLIER,
  type AiFxCandidate,
  type AiFxBoardState,
} from "./ai-fx";

const boardState: AiFxBoardState = { mixMode: "auto", crossfadeSeconds: null };

const fx = (id: string, category: AiFxCandidate["category"], bpm: number | null): AiFxCandidate => ({
  id,
  name: id,
  category,
  bpm,
  key: null,
  tags: [],
  durationSec: 3,
});

function anthropicResponse(text: string) {
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
}

describe("pickFallbackTransitionFx", () => {
  it("prefers transition-category FX, closest bpm to the current track", () => {
    const candidates = [fx("a", "effect", 100), fx("b", "transition", 128), fx("c", "transition", 140)];
    const result = pickFallbackTransitionFx({ bpm: 130 }, candidates);
    expect(result.fxId).toBe("b");
    expect(result.usedFallback).toBe(true);
  });

  it("falls back to the whole pool when no transition-category FX exists", () => {
    const candidates = [fx("a", "effect", 100), fx("b", "loop", 128)];
    const result = pickFallbackTransitionFx({ bpm: 126 }, candidates);
    expect(result.fxId).toBe("b");
  });

  it("returns a null fxId (not a crash) for an empty candidate list", () => {
    const result = pickFallbackTransitionFx({ bpm: 120 }, []);
    expect(result.fxId).toBeNull();
    expect(result.usedFallback).toBe(true);
  });

  it("falls back to the first candidate when nothing has bpm data", () => {
    const candidates = [fx("a", "transition", null), fx("b", "transition", null)];
    expect(pickFallbackTransitionFx({ bpm: null }, candidates).fxId).toBe("a");
  });
});

describe("pickTransitionFxWithAI", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const current = { title: "Current", bpm: 126, camelotKey: "8A", energy: 0.6 };
  const next = { title: "Next", bpm: 128, camelotKey: "9A", energy: 0.7 };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("returns a null-fxId fallback immediately for an empty library, without calling the API", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn() as unknown as typeof fetch;
    const result = await pickTransitionFxWithAI(current, next, [], boardState);
    expect(result.fxId).toBeNull();
    expect(result.usedFallback).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("falls back when no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    global.fetch = vi.fn() as unknown as typeof fetch;
    const candidates = [fx("a", "transition", 128)];
    const result = await pickTransitionFxWithAI(current, next, candidates, boardState);
    expect(result.usedFallback).toBe(true);
    expect(result.fxId).toBe("a");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns Claude's pick when the response is valid", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn(async () =>
      anthropicResponse(JSON.stringify({ fxId: "b", startOffsetSeconds: 1.5, volumeMultiplier: 0.4, reason: "Key match" }))
    ) as unknown as typeof fetch;
    const candidates = [fx("a", "transition", 100), fx("b", "transition", 128)];
    const result = await pickTransitionFxWithAI(current, next, candidates, boardState);
    expect(result).toEqual({
      fxId: "b",
      startOffsetSeconds: 1.5,
      volumeMultiplier: 0.4,
      reason: "Key match",
      usedFallback: false,
    });
  });

  it("caps an over-limit volumeMultiplier at MAX_FX_VOLUME_MULTIPLIER", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn(async () =>
      anthropicResponse(JSON.stringify({ fxId: "a", startOffsetSeconds: 0, volumeMultiplier: 1.0, reason: "" }))
    ) as unknown as typeof fetch;
    const candidates = [fx("a", "transition", 128)];
    const result = await pickTransitionFxWithAI(current, next, candidates, boardState);
    expect(result.volumeMultiplier).toBe(MAX_FX_VOLUME_MULTIPLIER);
  });

  it("strips a markdown code fence around the JSON response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn(async () =>
      anthropicResponse('```json\n{"fxId":"a","startOffsetSeconds":0,"volumeMultiplier":0.5,"reason":"note"}\n```')
    ) as unknown as typeof fetch;
    const candidates = [fx("a", "transition", 100)];
    const result = await pickTransitionFxWithAI(current, next, candidates, boardState);
    expect(result.fxId).toBe("a");
    expect(result.usedFallback).toBe(false);
  });

  it("falls back when Claude picks an fxId that isn't among the candidates", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn(async () =>
      anthropicResponse(JSON.stringify({ fxId: "not-a-candidate", startOffsetSeconds: 0, volumeMultiplier: 0.5, reason: "" }))
    ) as unknown as typeof fetch;
    const candidates = [fx("a", "transition", 100), fx("b", "transition", 128)];
    const result = await pickTransitionFxWithAI(current, next, candidates, boardState);
    expect(result.usedFallback).toBe(true);
    expect(result.fxId).toBe("b");
  });

  it("falls back on a non-ok response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const candidates = [fx("a", "transition", 100)];
    const result = await pickTransitionFxWithAI(current, next, candidates, boardState);
    expect(result.usedFallback).toBe(true);
  });

  it("falls back on a network failure without throwing", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const candidates = [fx("a", "transition", 100)];
    await expect(pickTransitionFxWithAI(current, next, candidates, boardState)).resolves.toEqual(
      expect.objectContaining({ usedFallback: true })
    );
  });

  it("falls back on malformed JSON in the response text", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn(async () => anthropicResponse("not json at all")) as unknown as typeof fetch;
    const candidates = [fx("a", "transition", 100)];
    const result = await pickTransitionFxWithAI(current, next, candidates, boardState);
    expect(result.usedFallback).toBe(true);
  });
});
