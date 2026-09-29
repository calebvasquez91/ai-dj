import { describe, expect, it, vi, afterEach } from "vitest";
import { pickByBpmProximity, pickNextTrackWithAI, type AiNextTrackCandidate, type AiDjBoardState } from "./ai-dj";

const boardState: AiDjBoardState = {
  mixMode: "auto",
  mixModeDescription: "No bias — pick whatever scores best",
  crossfadeSeconds: null,
  styleGenreHint: null,
  ambienceEnabled: true,
  mashupEnabled: true,
  djVarietyBias: false,
};

const candidate = (id: string, bpm: number | null): AiNextTrackCandidate => ({
  id,
  title: id,
  artist: "Artist",
  bpm,
  camelotKey: null,
  energy: null,
  hasRealAnalysis: true,
});

function anthropicResponse(text: string) {
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
}

describe("pickByBpmProximity", () => {
  it("picks the candidate with the closest bpm", () => {
    const candidates = [candidate("a", 100), candidate("b", 128), candidate("c", 140)];
    const result = pickByBpmProximity({ bpm: 130 }, candidates);
    expect(result).toEqual({
      trackId: "b",
      transitionNote: "Picked by BPM proximity (AI DJ pick unavailable).",
      recommendedCrossfadeSeconds: 8,
      usedFallback: true,
    });
  });

  it("falls back to the first candidate when nothing has bpm data", () => {
    const candidates = [candidate("a", null), candidate("b", null)];
    expect(pickByBpmProximity({ bpm: null }, candidates).trackId).toBe("a");
  });
});

describe("pickNextTrackWithAI", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("falls back to BPM proximity when no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    global.fetch = vi.fn() as unknown as typeof fetch;
    const candidates = [candidate("a", 100), candidate("b", 128)];
    const result = await pickNextTrackWithAI(candidate("current", 126), candidates, boardState);
    expect(result.usedFallback).toBe(true);
    expect(result.trackId).toBe("b");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns Claude's pick when the response is valid", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn(async () =>
      anthropicResponse(JSON.stringify({ trackId: "b", transitionNote: "Smooth key match", recommendedCrossfadeSeconds: 12 }))
    ) as unknown as typeof fetch;
    const candidates = [candidate("a", 100), candidate("b", 128)];
    const result = await pickNextTrackWithAI(candidate("current", 126), candidates, boardState);
    expect(result).toEqual({
      trackId: "b",
      transitionNote: "Smooth key match",
      recommendedCrossfadeSeconds: 12,
      usedFallback: false,
    });
  });

  it("strips a markdown code fence around the JSON response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn(async () =>
      anthropicResponse('```json\n{"trackId":"a","transitionNote":"note","recommendedCrossfadeSeconds":6}\n```')
    ) as unknown as typeof fetch;
    const candidates = [candidate("a", 100), candidate("b", 128)];
    const result = await pickNextTrackWithAI(candidate("current", 126), candidates, boardState);
    expect(result.trackId).toBe("a");
    expect(result.usedFallback).toBe(false);
  });

  it("falls back when Claude picks a trackId that isn't among the candidates", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn(async () =>
      anthropicResponse(JSON.stringify({ trackId: "not-a-candidate", transitionNote: "", recommendedCrossfadeSeconds: 6 }))
    ) as unknown as typeof fetch;
    const candidates = [candidate("a", 100), candidate("b", 128)];
    const result = await pickNextTrackWithAI(candidate("current", 126), candidates, boardState);
    expect(result.usedFallback).toBe(true);
    expect(result.trackId).toBe("b");
  });

  it("falls back on a non-ok response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const candidates = [candidate("a", 100), candidate("b", 128)];
    const result = await pickNextTrackWithAI(candidate("current", 126), candidates, boardState);
    expect(result.usedFallback).toBe(true);
  });

  it("falls back on a network failure without throwing", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const candidates = [candidate("a", 100), candidate("b", 128)];
    await expect(pickNextTrackWithAI(candidate("current", 126), candidates, boardState)).resolves.toEqual(
      expect.objectContaining({ usedFallback: true })
    );
  });

  it("falls back on malformed JSON in the response text", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn(async () => anthropicResponse("not json at all")) as unknown as typeof fetch;
    const candidates = [candidate("a", 100), candidate("b", 128)];
    const result = await pickNextTrackWithAI(candidate("current", 126), candidates, boardState);
    expect(result.usedFallback).toBe(true);
  });

  it("returns a fallback immediately when there are no candidates, without crashing", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn() as unknown as typeof fetch;
    const result = await pickNextTrackWithAI(candidate("current", 126), [], boardState);
    expect(result.usedFallback).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
