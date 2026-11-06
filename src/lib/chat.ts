/**
 * The AI DJ chat's shared rules: what a conversation and its context look like, how the server cleans what a client sends
 * (the prompt is paid for, so it is bounded whatever arrives), and the system prompt. No network and no key here, so the
 * Now Playing sheet can build the context in the browser and the route can validate it with the same code.
 */
import type { TrackAnalysis } from "@/lib/audio-analysis-core";
import { trackFeel } from "@/lib/moods";
import type { Track } from "@/types/music";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** What the DJ is told about a song: just what a human DJ would glance at. */
export interface ChatTrack {
  title: string;
  artist: string;
  bpm: number | null;
  key: string | null;
}

export interface ChatContext {
  currentTrack: ChatTrack | null;
  /** What is lined up, in order. */
  queue: ChatTrack[];
}

export type ChatOutcome = { kind: "reply"; reply: string } | { kind: "error"; message: string };

export const CHAT_UNREACHABLE = "The AI DJ couldn't be reached. Try again.";

/**
 * What the chat panel does with the route's response. A real answer is a reply; anything else is an error to show and
 * retry: a failed request, an unusable body, or the stock "can't answer right now" text the route sends when the model
 * couldn't be reached (`usedFallback`), which must not become something the DJ said or part of the history.
 */
export function interpretChatResponse(ok: boolean, data: unknown): ChatOutcome {
  const r = (typeof data === "object" && data !== null ? data : {}) as { reply?: unknown; usedFallback?: unknown; error?: unknown };
  if (!ok) return { kind: "error", message: typeof r.error === "string" && r.error ? r.error : CHAT_UNREACHABLE };
  if (typeof r.reply !== "string" || !r.reply.trim()) return { kind: "error", message: CHAT_UNREACHABLE };
  if (r.usedFallback === true) return { kind: "error", message: r.reply };
  return { kind: "reply", reply: r.reply };
}

/** The most messages sent to the model, newest kept. */
export const MAX_CHAT_MESSAGES = 20;
/** The longest a single message may be, in characters. */
export const MAX_MESSAGE_CHARS = 2000;
/** How many queued songs the DJ is told about. */
export const MAX_QUEUE_CONTEXT = 10;
const MAX_FIELD_CHARS = 80;

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function toChatTrack(track: Track, analysis: TrackAnalysis | undefined): ChatTrack {
  const { bpm } = trackFeel(track, analysis);
  const analysed = analysis != null && !analysis.fallback;
  return {
    title: clip(track.title, MAX_FIELD_CHARS),
    artist: clip(track.artist, MAX_FIELD_CHARS),
    bpm: bpm != null ? Math.round(bpm) : null,
    key: analysed ? (analysis.camelotKey ?? analysis.key ?? null) : null,
  };
}

/** The context the browser sends with each message: what is playing and the first few songs up next. */
export function buildChatContext(
  currentTrack: Track | null,
  queue: readonly Track[],
  analysis: Record<string, TrackAnalysis>
): ChatContext {
  return {
    currentTrack: currentTrack ? toChatTrack(currentTrack, analysis[currentTrack.id]) : null,
    queue: queue.slice(0, MAX_QUEUE_CONTEXT).map((t) => toChatTrack(t, analysis[t.id])),
  };
}

function cleanChatTrack(raw: unknown): ChatTrack | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== "string" || !r.title.trim()) return null;
  return {
    title: clip(r.title, MAX_FIELD_CHARS),
    artist: typeof r.artist === "string" ? clip(r.artist, MAX_FIELD_CHARS) : "",
    bpm: typeof r.bpm === "number" && Number.isFinite(r.bpm) && r.bpm > 0 && r.bpm < 400 ? Math.round(r.bpm) : null,
    key: typeof r.key === "string" && r.key.trim() ? clip(r.key, 20) : null,
  };
}

/** The context from a request body, whatever it contained: bounded, typed, never throwing. */
export function sanitizeContext(raw: unknown): ChatContext {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const queue = Array.isArray(r.queue) ? r.queue : [];
  return {
    currentTrack: cleanChatTrack(r.currentTrack),
    queue: queue
      .map(cleanChatTrack)
      .filter((t): t is ChatTrack => t !== null)
      .slice(0, MAX_QUEUE_CONTEXT),
  };
}

/**
 * The conversation from a request body, ready to send: valid roles and text only, each message clipped, same-role
 * neighbours joined, starting and ending with the user (the model answers the last user message), newest
 * MAX_CHAT_MESSAGES kept. Returns [] when there is nothing to answer.
 */
export function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const clean: ChatMessage[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = clip(content, MAX_MESSAGE_CHARS);
    if (!text) continue;
    const last = clean[clean.length - 1];
    if (last && last.role === role) last.content = clip(`${last.content}\n${text}`, MAX_MESSAGE_CHARS);
    else clean.push({ role, content: text });
  }
  const recent = clean.slice(-MAX_CHAT_MESSAGES);
  while (recent.length > 0 && recent[0].role !== "user") recent.shift();
  while (recent.length > 0 && recent[recent.length - 1].role !== "user") recent.pop();
  return recent;
}

function describeTrack(t: ChatTrack): string {
  const facts = [t.bpm != null ? `${t.bpm} BPM` : null, t.key ? `key ${t.key}` : null].filter(Boolean).join(", ");
  return `"${t.title}" by ${t.artist || "an unknown artist"}${facts ? ` (${facts})` : ""}`;
}

/** The system prompt: who the DJ is, what it can and cannot do, and what is playing right now. */
export function buildChatSystemPrompt(context: ChatContext): string {
  const lines = [
    "You are the AI DJ inside a DJ app: a friendly, concise partner for the listener.",
    "Help them decide what to play next, plan a set, and understand mixing choices (tempo, key, energy, transitions).",
    "Keep every answer under 120 words, in plain text.",
    "You can only talk. You cannot play, queue or change anything yourself, so when they want something played, name the songs and tell them to add or play them.",
    "Only talk about music and DJing; if asked about anything else, say so kindly and steer back.",
    "Never claim the listener owns a song you were not told about: suggest from the songs below, or describe the kind of song to look for.",
    "",
    context.currentTrack ? `Playing now: ${describeTrack(context.currentTrack)}.` : "Nothing is playing right now.",
  ];
  if (context.queue.length > 0) {
    lines.push("Up next, in order:");
    context.queue.forEach((t, i) => lines.push(`${i + 1}. ${describeTrack(t)}`));
  } else {
    lines.push("Nothing is lined up next.");
  }
  return lines.join("\n");
}
