/**
 * AI DJ next-track selection: during a Shuffle Play session, replaces the
 * local compatibility scorer (lib/track-sequencing.ts) with a real call to
 * the Anthropic API, asking Claude to pick the single best next track given
 * the current track, every remaining unplayed candidate, and the live DJ
 * board state (mix mode, crossfade length, ambience/mashup/variety toggles).
 *
 * Server-only (reads process.env.ANTHROPIC_API_KEY) — called from
 * app/api/dj/next-track/route.ts, never directly from the client. See
 * lib/store.ts's requestAiNextPick for the client-side caller.
 *
 * pickByBpmProximity has no server-only dependency (no process.env, no
 * fetch to Anthropic) and is also imported client-side, as the fallback
 * lib/store.ts uses if the request to our own /api/dj/next-track route
 * itself fails (network down, server error) — the same algorithm the route
 * already falls back to internally, so both paths degrade identically.
 */
import type { DjSetMode } from "@/lib/mix-engine";

export interface AiNextTrackCandidate {
  id: string;
  title: string;
  artist: string;
  /** null when this track has no known tempo yet (never analyzed, or a YouTube track with no metadata/tap-tempo match). */
  bpm: number | null;
  /** Camelot wheel notation (e.g. "8A"), null when key detection hasn't run or came back low-confidence. */
  camelotKey: string | null;
  /** 0-1 mean waveform energy (lib/track-sequencing.ts's meanEnergy) — null when unanalyzed. */
  energy: number | null;
  /** false for a YouTube track (no raw audio buffer access, so bpm/key/energy above are a best-effort metadata match or a structural estimate, never real per-sample analysis) or a local track that hasn't been analyzed yet. Told to Claude explicitly so it can weigh these fields' reliability, not just their presence. */
  hasRealAnalysis: boolean;
}

export interface AiDjBoardState {
  mixMode: DjSetMode;
  mixModeDescription: string;
  /** Manual crossfade override in seconds, null when the mix engine is left to choose automatically per-transition. */
  crossfadeSeconds: number | null;
  /** Session-wide style hint (e.g. "house") — not a per-track genre tag, see track-sequencing.ts's own note on why genre isn't tracked per track. */
  styleGenreHint: string | null;
  ambienceEnabled: boolean;
  mashupEnabled: boolean;
  djVarietyBias: boolean;
}

export interface AiNextTrackResult {
  trackId: string;
  transitionNote: string;
  recommendedCrossfadeSeconds: number;
  /** true when this result came from pickByBpmProximity rather than a real Claude response — lets callers label the pick honestly instead of claiming AI credit for a fallback. */
  usedFallback: boolean;
}

/** Mirrors PlayerBar.tsx's DJ_MODES title strings — kept here (not imported from a component) so this lib stays component-independent. */
export const DJ_MODE_DESCRIPTIONS: Record<DjSetMode, string> = {
  auto: "No bias — pick whatever scores best",
  club: "Favors beatmatched, EQ-driven blends over flashy effects",
  wedding: "Favors clean, safe blends; avoids scratches, risers, and other flashy effects",
  party: "Leans into crowd-hype moments — tags, word play, risers, drops",
  chill: "Favors long, smooth blends and reverb washes; avoids anything abrupt",
  "open-format": "Leans into bold genre/tempo bridges — tempo ramps, brakes, spin-ups, hard cuts",
};

/** Candidate list sent to Claude is capped here (lib/store.ts applies this when building the request) — keeps the prompt payload and cost bounded on very large libraries without limiting what the *local* rolling queue can still draw from. */
export const AI_CANDIDATE_CAP = 60;

const SYSTEM_PROMPT =
  "You are an AI DJ. Given the current track and the remaining unplayed tracks, choose the single best next track for a seamless mix. Consider BPM compatibility (prefer within 6 BPM or exact double/half), key compatibility (same key, relative major/minor, or adjacent on the circle of fifths), energy arc (build, sustain, or release depending on DJ board energy setting), and the active mix mode. Each candidate has hasRealAnalysis: true (real per-track BPM/key/energy detection) or false (a rough metadata-based or estimated guess, less trustworthy) — when two candidates are otherwise close, prefer the one with hasRealAnalysis: true. Return only a JSON object: { trackId: string, transitionNote: string, recommendedCrossfadeSeconds: number }";

// The originally-specified "claude-sonnet-4-20250514" 404s on the current
// Anthropic API (confirmed in production logs — not_found_error) — that
// model id no longer exists. claude-sonnet-5 is the current Sonnet model.
const MODEL = "claude-sonnet-5";
const ANTHROPIC_TIMEOUT_MS = 8000;
const DEFAULT_FALLBACK_CROSSFADE_SEC = 8;

/** Bare-minimum "playback never stops" fallback (used both server-side, when the Claude call itself fails/times out, and client-side, if the request to our own route fails outright) — picks the unplayed candidate with the closest BPM to the current track. Ties/no-bpm-data favor array order, which is fine: this only ever runs when there's no richer signal to reason about. */
export function pickByBpmProximity(
  current: Pick<AiNextTrackCandidate, "bpm">,
  candidates: AiNextTrackCandidate[]
): AiNextTrackResult {
  if (candidates.length === 0) throw new Error("pickByBpmProximity requires at least one candidate.");
  let best = candidates[0];
  let bestDelta = Infinity;
  for (const candidate of candidates) {
    const delta =
      current.bpm != null && candidate.bpm != null ? Math.abs(candidate.bpm - current.bpm) : Number.MAX_SAFE_INTEGER;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  return {
    trackId: best.id,
    transitionNote: "Picked by BPM proximity (AI DJ pick unavailable).",
    recommendedCrossfadeSeconds: DEFAULT_FALLBACK_CROSSFADE_SEC,
    usedFallback: true,
  };
}

function extractJsonObject(text: string): unknown {
  // Claude sometimes wraps JSON in a ```json ... ``` fence despite being
  // asked for "only a JSON object" — strip it defensively rather than
  // trusting the instruction to always be followed exactly.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

/**
 * Asks Claude to pick the next track. Never throws — any failure (missing
 * API key, network error, timeout, malformed/invalid response, a trackId
 * that isn't actually among the candidates) falls back to
 * pickByBpmProximity so shuffle playback never stalls waiting on this call.
 */
export async function pickNextTrackWithAI(
  current: AiNextTrackCandidate,
  candidates: AiNextTrackCandidate[],
  boardState: AiDjBoardState
): Promise<AiNextTrackResult> {
  // Callers (the /api/dj/next-track route, and store.ts's requestAiNextPick)
  // are expected to never call this with an empty candidate list — there's
  // no track left to pick — but guard it here too rather than letting
  // pickByBpmProximity below crash on an empty array.
  if (candidates.length === 0) {
    return {
      trackId: current.id,
      transitionNote: "No unplayed candidates available.",
      recommendedCrossfadeSeconds: DEFAULT_FALLBACK_CROSSFADE_SEC,
      usedFallback: true,
    };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return pickByBpmProximity(current, candidates);

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
            content: JSON.stringify({
              currentTrack: current,
              remainingUnplayedTracks: candidates,
              djBoardState: boardState,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[ai-dj] Anthropic API returned ${res.status}: ${await res.text().catch(() => "")}`);
      return pickByBpmProximity(current, candidates);
    }

    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      console.warn("[ai-dj] Anthropic response had no text content block", JSON.stringify(data));
      return pickByBpmProximity(current, candidates);
    }

    const parsed = extractJsonObject(text) as {
      trackId?: unknown;
      transitionNote?: unknown;
      recommendedCrossfadeSeconds?: unknown;
    };
    const trackId = typeof parsed.trackId === "string" ? parsed.trackId : null;
    if (!trackId || !candidates.some((c) => c.id === trackId)) {
      console.warn(`[ai-dj] Claude picked an unusable trackId: ${JSON.stringify(parsed)}`);
      return pickByBpmProximity(current, candidates);
    }

    return {
      trackId,
      transitionNote: typeof parsed.transitionNote === "string" ? parsed.transitionNote : "",
      recommendedCrossfadeSeconds:
        typeof parsed.recommendedCrossfadeSeconds === "number" && parsed.recommendedCrossfadeSeconds > 0
          ? parsed.recommendedCrossfadeSeconds
          : DEFAULT_FALLBACK_CROSSFADE_SEC,
      usedFallback: false,
    };
  } catch (err) {
    console.warn("[ai-dj] Anthropic call failed, falling back to BPM proximity:", err);
    return pickByBpmProximity(current, candidates);
  }
}
