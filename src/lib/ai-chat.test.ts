import { afterEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_REPLY, chatWithDj } from "./ai-chat";

const context = { currentTrack: null, queue: [] };
const messages = [{ role: "user" as const, content: "what next?" }];

function anthropicResponse(text: string) {
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("chatWithDj", () => {
  it("falls back without calling out when there is no API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await chatWithDj(messages, context)).toEqual({ reply: FALLBACK_REPLY, usedFallback: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the model's text and sends the conversation with the system prompt", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchSpy = vi.fn().mockResolvedValue(anthropicResponse("  Play something slower.  "));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await chatWithDj(messages, context)).toEqual({ reply: "Play something slower.", usedFallback: false });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.messages).toEqual(messages);
    expect(body.system).toContain("You can only talk.");
    expect((init as RequestInit & { headers: Record<string, string> }).headers["x-api-key"]).toBe("test-key");
  });

  it("falls back on an HTTP error", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    expect((await chatWithDj(messages, context)).usedFallback).toBe(true);
  });

  it("falls back on a response with no text, and on a network failure", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [] }), { status: 200 })));
    expect((await chatWithDj(messages, context)).usedFallback).toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect((await chatWithDj(messages, context)).usedFallback).toBe(true);
  });
});
