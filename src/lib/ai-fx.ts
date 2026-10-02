/**
 * AI-matched transition FX: during a transition, replaces a fixed/no FX
 * choice with a real call to the Anthropic API, asking Claude to pick the
 * single best FX sound (from the user's uploaded FX library) to play during
 * the crossfade, plus when to start it and how loud.
 *
 * Server-only (reads process.env.ANTHROPIC_API_KEY) — called from
 * app/api/dj/next-fx/route.ts, never directly from the client. See
 * lib/store.ts's requestAiFxPick for the client-side caller. Mirrors
 * lib/ai-dj.ts's shape exactly (same model, same defensive JSON parsing,
 * same never-throws contract) so the two AI call sites stay consistent.
 */
import type { DjSetMode } from "@/lib/mix-engine";
import type { FxCategory } from "@/types/music";

export interface AiFxTrackProfile {
  title: string;
  /** null when this track has no known tempo (never analyzed, or a YouTube track with no metadata/tap-tempo match). */
  bpm: number | null;
  /** Camelot wheel notation (e.g. "8A"), null when key detection hasn't run or came back low-confidence. */
  camelotKey: string | null;
  /** 0-1 mean waveform energy (lib/track-sequencing.ts's meanEnergy) — null when unanalyzed. */
  energy: number | null;
}

export interface AiFxCandidate {
  id: string;
  name: string;
  category: FxCategory;
  /** null when the user never set one — most FX don't have a meaningful tempo. */
  bpm: number | null;
  key: string | null;
  tags: string[];
  durationSec: number;
}

export interface AiFxBoardState {
  mixMode: DjSetMode;
  /** Manual crossfade override in seconds, null when the mix engine chooses automatically. */
  crossfadeSeconds: number | null;
}

export interface AiFxPickResult {
  /** null means "play no FX for this transition" — a legitimate choice (empty library, or nothing fits), not a failure. */
  fxId: string | null;
  startOffsetSeconds: number;
  volumeMultiplier: number;
  reason: string;
  /** true when this result came from pickFallbackTransitionFx rather than a real Claude response. */
  usedFallback: boolean;
}

const MODEL = "claude-sonnet-5";
const ANTHROPIC_TIMEOUT_MS = 8000;
// Hard cap enforced here AND where the FX layer actually gets its gain set
// (DualDeckStage.tsx) — belt and suspenders, since this value also flows
// through a client request/response round trip.
export const MAX_FX_VOLUME_MULTIPLIER = 0.65;
const DEFAULT_VOLUME_MULTIPLIER = 0.5;
/** Generous sanity cap — no real crossfade window runs anywhere near this long (see mix-engine.ts's MAX_CROSSFADE_SEC). Just stops a wildly out-of-range AI response from scheduling the FX far outside any transition's actual lifetime. */
const MAX_FX_START_OFFSET_SEC = 30;

const SYSTEM_PROMPT =
  "You are an expert DJ and sound designer. Given two tracks and a library of FX sounds, select the single best transition FX to play during the crossfade. If the FX has no BPM or key data, infer compatibility from its name, tags, category, and duration relative to the crossfade window. For sounds with unknown key or BPM, reason about the mood and texture — a rising sweep works universally, a vocal stab needs key alignment. Return only JSON: { fxId: string, startOffsetSeconds: number, volumeMultiplier: number, reason: string }";

/** Bare-minimum fallback (used both server-side, when the Claude call itself fails/times out, and client-side, if the request to our own route fails outright) — prefers a "transition"-category FX, closest BPM to the current track when both have one, first candidate otherwise. null fxId when the library (or the filtered candidate set, e.g. halloween-affinity-only) is empty — silence is a valid outcome, not an error. */
export function pickFallbackTransitionFx(
  current: Pick<AiFxTrackProfile, "bpm">,
  candidates: AiFxCandidate[]
): AiFxPickResult {
  const pool = candidates.some((c) => c.category === "transition")
    ? candidates.filter((c) => c.category === "transition")
    : candidates;

  if (pool.length === 0) {
    return {
      fxId: null,
      startOffsetSeconds: 0,
      volumeMultiplier: DEFAULT_VOLUME_MULTIPLIER,
      reason: "No FX available for this transition.",
      usedFallback: true,
    };
  }

  let best = pool[0];
  let bestDelta = Infinity;
  for (const candidate of pool) {
    const delta =
      current.bpm != null && candidate.bpm != null ? Math.abs(candidate.bpm - current.bpm) : Number.MAX_SAFE_INTEGER;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  return {
    fxId: best.id,
    startOffsetSeconds: 0,
    volumeMultiplier: DEFAULT_VOLUME_MULTIPLIER,
    reason: "Picked by category + BPM proximity (AI FX pick unavailable).",
    usedFallback: true,
  };
}

function extractJsonObject(text: string): unknown {
  // Claude sometimes wraps JSON in a ```json ... ``` fence despite being
  // asked for "only JSON" — strip it defensively, same as ai-dj.ts.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

/**
 * Asks Claude to pick the best transition FX. Never throws — any failure
 * (missing API key, network error, timeout, malformed/invalid response, an
 * fxId that isn't actually among the candidates) falls back to
 * pickFallbackTransitionFx so a transition never stalls waiting on this.
 */
export async function pickTransitionFxWithAI(
  currentTrack: AiFxTrackProfile,
  nextTrack: AiFxTrackProfile,
  fxLibrary: AiFxCandidate[],
  boardState: AiFxBoardState
): Promise<AiFxPickResult> {
  if (fxLibrary.length === 0) {
    return {
      fxId: null,
      startOffsetSeconds: 0,
      volumeMultiplier: DEFAULT_VOLUME_MULTIPLIER,
      reason: "FX library is empty.",
      usedFallback: true,
    };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return pickFallbackTransitionFx(currentTrack, fxLibrary);

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
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: JSON.stringify({ currentTrack, nextTrack, fxLibrary, boardState }),
          },
        ],
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[ai-fx] Anthropic API returned ${res.status}: ${await res.text().catch(() => "")}`);
      return pickFallbackTransitionFx(currentTrack, fxLibrary);
    }

    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      console.warn("[ai-fx] Anthropic response had no text content block", JSON.stringify(data));
      return pickFallbackTransitionFx(currentTrack, fxLibrary);
    }

    const parsed = extractJsonObject(text) as {
      fxId?: unknown;
      startOffsetSeconds?: unknown;
      volumeMultiplier?: unknown;
      reason?: unknown;
    };
    const fxId = typeof parsed.fxId === "string" ? parsed.fxId : null;
    if (!fxId || !fxLibrary.some((c) => c.id === fxId)) {
      console.warn(`[ai-fx] Claude picked an unusable fxId: ${JSON.stringify(parsed)}`);
      return pickFallbackTransitionFx(currentTrack, fxLibrary);
    }

    const volumeMultiplier =
      typeof parsed.volumeMultiplier === "number" && parsed.volumeMultiplier > 0
        ? Math.min(parsed.volumeMultiplier, MAX_FX_VOLUME_MULTIPLIER)
        : DEFAULT_VOLUME_MULTIPLIER;
    // Upper-bounded the same way volumeMultiplier is above — a real
    // crossfade window is a few seconds at most (see mix-engine.ts), so an
    // unclamped value here (whether a hallucinated number or just a raw
    // passthrough) could schedule the FX to start playing well after this
    // transition — and the ones after it — have already finished, as a
    // surprise sound with no visible connection to anything on screen.
    // DualDeckStage.tsx clamps a second time against the transition's own
    // actual windowSec, which isn't known here.
    const startOffsetSeconds =
      typeof parsed.startOffsetSeconds === "number" && parsed.startOffsetSeconds >= 0
        ? Math.min(parsed.startOffsetSeconds, MAX_FX_START_OFFSET_SEC)
        : 0;

    return {
      fxId,
      startOffsetSeconds,
      volumeMultiplier,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      usedFallback: false,
    };
  } catch (err) {
    console.warn("[ai-fx] Anthropic call failed, falling back:", err);
    return pickFallbackTransitionFx(currentTrack, fxLibrary);
  }
}
