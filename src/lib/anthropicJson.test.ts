import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_DJ_MODEL, askClaudeForJson } from "@/lib/anthropicJson";

const request = { system: "sys", user: { a: 1 }, maxTokens: 100, timeoutMs: 1000, label: "test" };
const realKey = process.env.ANTHROPIC_API_KEY;

function reply(text: string, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = realKey;
});

describe("askClaudeForJson", () => {
  it("returns null without calling the network when there is no API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await askClaudeForJson(request)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the model, system prompt and JSON-encoded user message, with the key only in a header", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = reply('{"ok": true}');
    vi.stubGlobal("fetch", fetchMock);
    expect(await askClaudeForJson(request)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ model: AI_DJ_MODEL, max_tokens: 100, system: "sys" });
    expect(sent.messages).toEqual([{ role: "user", content: '{"a":1}' }]);
    expect(String(init.body)).not.toContain("test-key");
  });

  it("reads JSON out of a fenced reply", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", reply('```json\n{"x": 2}\n```'));
    expect(await askClaudeForJson(request)).toEqual({ x: 2 });
  });

  it("returns null, with a warning, for an HTTP error, an empty reply, text with no JSON and a thrown fetch", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const empty = vi.fn(async () => new Response(JSON.stringify({ content: [] }), { status: 200 }));
    const thrown = vi.fn(async () => {
      throw new Error("down");
    });
    for (const impl of [reply("{}", 500), empty, reply("no json here"), thrown]) {
      vi.stubGlobal("fetch", impl);
      expect(await askClaudeForJson(request)).toBeNull();
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });
});
