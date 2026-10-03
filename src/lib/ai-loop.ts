/**
 * AI-picked Halloween ambient loop: once per new track, asks Claude which
 * loop (from the user's "background"-category FX library) should play
 * quietly underneath it, avoiding the loop that just played.
 *
 * Server-only (reads process.env.ANTHROPIC_API_KEY) — called from
 * app/api/dj/next-loop/route.ts. The client side is lib/loopApi.ts. Same
 * shape as lib/ai-fx.ts: same model, same defensive JSON parsing, same
 * never-throws contract, with a random fallback (excluding the previous
 * loop) when the call fails or doesn't answer within the timeout.
 */

import { extractJsonObject } from "@/lib/json-extract";

export interface AiLoopTrackProfile {
  title: string;
  /** null when this track has no known tempo. */
  bpm: number | null;
  /** Camelot wheel notation (e.g. "8A"), null when unknown. */
  camelotKey: string | null;
  /** Free-text mood hint derived from the track's tags/title — Claude infers the rest. */
  mood: string | null;
}

export interface AiLoopCandidate {
  id: string;
  name: string;
  durationSec: number;
}

export interface AiLoopPickResult {
  /** null only when there are no candidates at all. */
  fxId: string | null;
  reason: string;
  /** true when this came from pickFallbackLoop rather than a real Claude response. */
  usedFallback: boolean;
}

const MODEL = "claude-sonnet-5";
/** Spec: fall back to a random loop if the pick hasn't answered within 3 seconds — the client's total budget (lib/loopApi.ts). */
export const LOOP_PICK_TIMEOUT_MS = 3000;
/** The server's own Anthropic call gets less than the client's budget, so a slow answer is abandoned server-side (no paid call wasted) before the client has already given up on it. */
const AI_CALL_TIMEOUT_MS = 2500;

export const MAX_LOOP_CANDIDATES = 100;
const MAX_TEXT_LEN = 200;
const MAX_ID_LEN = 100;

const SYSTEM_PROMPT =
  "You are an AI DJ. Select the best Halloween ambient loop to play quietly underneath this track. The loop should complement the song's mood without clashing. Infer the loop's character from its file name — words like 'organ', 'wind', 'thunder', 'heartbeat', 'choir' tell you its texture. Avoid repeating the previous loop. Prefer loops longer than 8 seconds for continuity. Return only JSON: { fxId: string, reason: string }";

function clipText(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

/**
 * Validates and bounds an untrusted /api/dj/next-loop request body before it
 * becomes a paid Claude prompt: capped candidate count, capped string
 * lengths, numbers coerced. Null when the body is unusable (no track title,
 * or availableLoops isn't an array).
 */
export function sanitizeLoopRequest(
  body: unknown
): { currentTrack: AiLoopTrackProfile; availableLoops: AiLoopCandidate[]; previousLoopId: string | null } | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as { currentTrack?: unknown; availableLoops?: unknown; previousLoopId?: unknown };
  const track = raw.currentTrack as Record<string, unknown> | null | undefined;
  if (typeof track !== "object" || track === null || typeof track.title !== "string") return null;
  if (!Array.isArray(raw.availableLoops)) return null;

  const availableLoops: AiLoopCandidate[] = [];
  for (const item of raw.availableLoops) {
    if (availableLoops.length >= MAX_LOOP_CANDIDATES) break;
    if (typeof item !== "object" || item === null) continue;
    const loop = item as Record<string, unknown>;
    if (typeof loop.id !== "string" || loop.id.length === 0 || loop.id.length > MAX_ID_LEN) continue;
    availableLoops.push({
      id: loop.id,
      name: clipText(loop.name, MAX_TEXT_LEN) ?? "",
      durationSec:
        typeof loop.durationSec === "number" && Number.isFinite(loop.durationSec) ? Math.max(0, loop.durationSec) : 0,
    });
  }

  return {
    currentTrack: {
      title: track.title.slice(0, MAX_TEXT_LEN),
      bpm: typeof track.bpm === "number" && Number.isFinite(track.bpm) ? track.bpm : null,
      camelotKey: clipText(track.camelotKey, 8),
      mood: clipText(track.mood, MAX_TEXT_LEN),
    },
    availableLoops,
    previousLoopId:
      typeof raw.previousLoopId === "string" && raw.previousLoopId.length <= MAX_ID_LEN ? raw.previousLoopId : null,
  };
}

/** Random pick excluding the previous loop (when anything else exists). null fxId only for an empty candidate list. `random` is injectable for tests. */
export function pickFallbackLoop(
  candidates: AiLoopCandidate[],
  previousLoopId: string | null,
  random: () => number = Math.random
): AiLoopPickResult {
  if (candidates.length === 0) return { fxId: null, reason: "No loops available.", usedFallback: true };
  const others = candidates.filter((c) => c.id !== previousLoopId);
  const pool = others.length > 0 ? others : candidates;
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return { fxId: pool[index].id, reason: "Random pick (fallback).", usedFallback: true };
}

/** Asks Claude for the best loop. Never throws — any failure, timeout, or unusable answer falls back to pickFallbackLoop. */
export async function pickLoopWithAI(
  currentTrack: AiLoopTrackProfile,
  availableLoops: AiLoopCandidate[],
  previousLoopId: string | null
): Promise<AiLoopPickResult> {
  if (availableLoops.length === 0) return pickFallbackLoop(availableLoops, previousLoopId);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return pickFallbackLoop(availableLoops, previousLoopId);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: JSON.stringify({ currentTrack, availableLoops, previousLoopId }) },
        ],
      }),
      signal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[ai-loop] Anthropic API returned ${res.status}: ${await res.text().catch(() => "")}`);
      return pickFallbackLoop(availableLoops, previousLoopId);
    }

    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) return pickFallbackLoop(availableLoops, previousLoopId);

    const parsed = extractJsonObject(text) as { fxId?: unknown; reason?: unknown };
    const fxId = typeof parsed.fxId === "string" ? parsed.fxId : null;
    if (!fxId || !availableLoops.some((c) => c.id === fxId)) {
      console.warn(`[ai-loop] Claude picked an unusable fxId: ${JSON.stringify(parsed)}`);
      return pickFallbackLoop(availableLoops, previousLoopId);
    }
    // The prompt asks Claude not to repeat the previous loop; enforce it too,
    // unless that's the only loop there is.
    if (fxId === previousLoopId && availableLoops.length > 1) {
      return pickFallbackLoop(availableLoops, previousLoopId);
    }
    return {
      fxId,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      usedFallback: false,
    };
  } catch (err) {
    console.warn("[ai-loop] Anthropic call failed, falling back:", err);
    return pickFallbackLoop(availableLoops, previousLoopId);
  }
}
