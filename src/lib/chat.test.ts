import { describe, expect, it } from "vitest";
import type { TrackAnalysis } from "@/lib/audio-analysis-core";
import type { Track } from "@/types/music";
import {
  MAX_CHAT_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_QUEUE_CONTEXT,
  buildChatContext,
  buildChatSystemPrompt,
  sanitizeContext,
  sanitizeMessages,
} from "./chat";

function track(id: string, extra: Partial<Track> = {}): Track {
  return { id, title: `Song ${id}`, artist: `Artist ${id}`, source: "local", sourceUrl: `/t/${id}`, durationSec: 200, addedAt: 0, ...extra } as Track;
}
const analysis = (bpm: number, camelotKey: string | null, fallback = false) =>
  ({ bpm, camelotKey, key: null, waveformPeaks: [], fallback }) as unknown as TrackAnalysis;

describe("buildChatContext", () => {
  it("describes the playing song and the queue with tempo and key from the analysis", () => {
    const ctx = buildChatContext(track("a"), [track("b")], { a: analysis(127.6, "8A"), b: analysis(100, "5B") });
    expect(ctx.currentTrack).toEqual({ title: "Song a", artist: "Artist a", bpm: 128, key: "8A" });
    expect(ctx.queue).toEqual([{ title: "Song b", artist: "Artist b", bpm: 100, key: "5B" }]);
  });

  it("leaves out tempo and key it does not trust or know", () => {
    const ctx = buildChatContext(track("a"), [], { a: analysis(120, "8A", true) });
    expect(ctx.currentTrack).toMatchObject({ bpm: null, key: null });
  });

  it("is empty with nothing playing, and caps the queue", () => {
    expect(buildChatContext(null, [], {})).toEqual({ currentTrack: null, queue: [] });
    const many = Array.from({ length: 30 }, (_, i) => track(String(i)));
    expect(buildChatContext(null, many, {}).queue).toHaveLength(MAX_QUEUE_CONTEXT);
  });
});

describe("sanitizeContext", () => {
  it("keeps good data and drops bad data", () => {
    const ctx = sanitizeContext({
      currentTrack: { title: " Hello ", artist: "Me", bpm: 120.4, key: "8A" },
      queue: [{ title: "ok" }, { title: "" }, 5, null, { title: "x", bpm: "fast" }],
    });
    expect(ctx.currentTrack).toEqual({ title: "Hello", artist: "Me", bpm: 120, key: "8A" });
    expect(ctx.queue.map((t) => t.title)).toEqual(["ok", "x"]);
    expect(ctx.queue[1].bpm).toBeNull();
  });

  it("survives anything", () => {
    expect(sanitizeContext(undefined)).toEqual({ currentTrack: null, queue: [] });
    expect(sanitizeContext("nope")).toEqual({ currentTrack: null, queue: [] });
    expect(sanitizeContext({ queue: "x" })).toEqual({ currentTrack: null, queue: [] });
  });

  it("clips long text and absurd tempos", () => {
    const ctx = sanitizeContext({ currentTrack: { title: "x".repeat(500), bpm: 9999 } });
    expect(ctx.currentTrack!.title).toHaveLength(80);
    expect(ctx.currentTrack!.bpm).toBeNull();
  });
});

describe("sanitizeMessages", () => {
  it("keeps a normal conversation", () => {
    const msgs = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "what next?" },
    ];
    expect(sanitizeMessages(msgs)).toEqual(msgs);
  });

  it("drops bad entries and empty text, and trims", () => {
    expect(sanitizeMessages([null, 5, { role: "system", content: "x" }, { role: "user", content: "   " }, { role: "user", content: " hey " }])).toEqual([
      { role: "user", content: "hey" },
    ]);
  });

  it("joins same-role neighbours", () => {
    expect(sanitizeMessages([{ role: "user", content: "a" }, { role: "user", content: "b" }])).toEqual([{ role: "user", content: "a\nb" }]);
  });

  it("starts and ends with the user", () => {
    expect(
      sanitizeMessages([
        { role: "assistant", content: "stray" },
        { role: "user", content: "q" },
        { role: "assistant", content: "a" },
      ])
    ).toEqual([{ role: "user", content: "q" }]);
  });

  it("keeps the newest messages and clips long ones", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` }));
    const out = sanitizeMessages(many);
    expect(out.length).toBeLessThanOrEqual(MAX_CHAT_MESSAGES);
    expect(out[0].role).toBe("user");
    expect(out[out.length - 1].content).toBe("m38");
    expect(sanitizeMessages([{ role: "user", content: "x".repeat(5000) }])[0].content).toHaveLength(MAX_MESSAGE_CHARS);
  });

  it("is empty for nothing usable", () => {
    expect(sanitizeMessages(undefined)).toEqual([]);
    expect(sanitizeMessages("hi")).toEqual([]);
    expect(sanitizeMessages([{ role: "assistant", content: "only me" }])).toEqual([]);
  });
});

describe("buildChatSystemPrompt", () => {
  it("tells the DJ what is playing and queued", () => {
    const prompt = buildChatSystemPrompt({
      currentTrack: { title: "Dance Floor", artist: "Daft Punk", bpm: 123, key: "8A" },
      queue: [{ title: "Daughter", artist: "Elbow", bpm: null, key: null }],
    });
    expect(prompt).toContain('Playing now: "Dance Floor" by Daft Punk (123 BPM, key 8A).');
    expect(prompt).toContain('1. "Daughter" by Elbow');
  });

  it("says so when nothing is playing or queued", () => {
    const prompt = buildChatSystemPrompt({ currentTrack: null, queue: [] });
    expect(prompt).toContain("Nothing is playing right now.");
    expect(prompt).toContain("Nothing is lined up next.");
  });

  it("makes clear the DJ can only talk, and never mentions the old mascot", () => {
    const prompt = buildChatSystemPrompt({ currentTrack: null, queue: [] });
    expect(prompt).toContain("You can only talk.");
    expect(prompt).not.toMatch(/\bQue\b/);
  });
});
