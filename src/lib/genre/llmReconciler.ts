/**
 * LlmReconcilerProvider (Claude Haiku): the last resort, called only when the other sources disagree or none is confident.
 * It is shown the track's title, artist, album and year and every source's tags with their confidences, and answers with
 * genres on the taxonomy, moods, and a reason. It is told to answer "unknown" (no genres) rather than guess for an obscure
 * track, and its answer is checked: a genre or subgenre that is not on the taxonomy is dropped, a confidence is clamped to
 * 0.85 (a model's say-so is never as good as two independent sources agreeing), and a mood not on the list is dropped.
 *
 * The answer comes through a tool call whose input schema fixes the shape (genre is an enum of the taxonomy's labels), so
 * the JSON always parses. The taxonomy is in its own system block marked for prompt caching, so repeated calls reuse it.
 * Server-only: the key is ANTHROPIC_API_KEY, read at call time. Answers are cached by what the model was shown.
 */
import { createHash } from "node:crypto";
import { GENRES, genreLabels, isTaxonomyNode } from "@/lib/genres";
import { isMoodId, moodIds, normalizeMood } from "@/lib/moodTags";
import type { GenreTag } from "@/types/music";
import { CACHE_TTL_MS, EMPTY_RESULT, type Fetcher, type GenreProvider, type ProviderCacheStore, type ProviderInput, type ProviderResult } from "@/lib/genre/types";

/** A current, non-deprecated model id (CLAUDE.md). Overridable with GENRE_LLM_MODEL. */
export const GENRE_LLM_MODEL = "claude-haiku-5-5";
export const LLM_CONFIDENCE_CAP = 0.85;
const TOOL_NAME = "report_genres";

/** The taxonomy as the model is shown it: one line per genre, its subgenres after a colon. */
export function taxonomyPrompt(): string {
  return GENRES.map((g) => `${g.label}: ${g.subgenres.map((s) => s.label).join(", ")}`).join("\n");
}

const SYSTEM = `You classify one music track into a fixed genre taxonomy for a DJ app.
You are given the track's title, artist, album and year, and what other sources said about it (genre tags with confidences from the file's own tags, MusicBrainz, Last.fm or an audio model).
Choose from the taxonomy only. Never invent a genre or a subgenre; a subgenre must belong to the genre it is given with.
A track can have more than one genre; give the best one or two, most confident first.
Be honest about confidence: the sources disagreeing is a reason to be less sure, not to pick a side with high confidence.
If you do not recognise the track and the sources give you nothing to go on, answer with no genres (an empty list) and the reason "unknown". Do not guess for an obscure track.
Also name up to three moods from the allowed list, only if the track clearly has them.
Do not quote or reproduce lyrics.`;

export interface LlmReconcileInput {
  title: string;
  artist: string;
  album?: string | null;
  year?: number | null;
  sources: { source: string; tags: { genre: string; subgenre?: string; confidence: number }[]; moods?: string[] }[];
}

interface ToolInput {
  genres?: { genre?: unknown; subgenre?: unknown; confidence?: unknown }[];
  moods?: unknown;
  reason?: unknown;
}

function toolSchema() {
  return {
    name: TOOL_NAME,
    description: "Report the genres and moods for the track. Report no genres and the reason \"unknown\" if you do not know.",
    input_schema: {
      type: "object",
      properties: {
        genres: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              genre: { type: "string", enum: [...genreLabels()] },
              subgenre: { type: "string", description: "A subgenre of that genre from the taxonomy, or omit it." },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["genre", "confidence"],
          },
        },
        moods: { type: "array", maxItems: 3, items: { type: "string", enum: moodIds() } },
        reason: { type: "string", description: "One short sentence, or \"unknown\"." },
      },
      required: ["genres", "moods", "reason"],
    },
  };
}

/** The model's answer, checked against the taxonomy. */
export function validateReconcile(raw: unknown, at: number): { tags: GenreTag[]; moods: string[]; reason: string } {
  const input = (raw ?? {}) as ToolInput;
  const tags: GenreTag[] = [];
  for (const g of Array.isArray(input.genres) ? input.genres : []) {
    if (typeof g?.genre !== "string") continue;
    const confidence = typeof g.confidence === "number" && Number.isFinite(g.confidence) ? Math.max(0, Math.min(LLM_CONFIDENCE_CAP, g.confidence)) : 0;
    if (!isTaxonomyNode(g.genre)) continue;
    const subgenre = typeof g.subgenre === "string" && isTaxonomyNode(g.genre, g.subgenre) ? g.subgenre : undefined;
    if (confidence <= 0) continue;
    tags.push({ genre: g.genre, ...(subgenre ? { subgenre } : {}), source: "llm", confidence, updatedAt: at });
  }
  const moods = (Array.isArray(input.moods) ? input.moods : [])
    .map((m) => (typeof m === "string" ? (isMoodId(m) ? m : normalizeMood(m)) : null))
    .filter((m): m is string => m != null);
  const reason = typeof input.reason === "string" ? input.reason.slice(0, 300) : "";
  return { tags, moods: [...new Set(moods)].slice(0, 3), reason };
}

export interface LlmReconcilerOptions {
  fetcher: Fetcher;
  cache: ProviderCacheStore;
  apiKey: () => string | undefined;
  model?: () => string;
  now?: () => number;
}

export function createLlmReconciler({ fetcher, cache, apiKey, model = () => process.env.GENRE_LLM_MODEL || GENRE_LLM_MODEL, now = Date.now }: LlmReconcilerOptions): GenreProvider {
  return {
    id: "llm",
    async classify(input: ProviderInput): Promise<ProviderResult> {
      const key = apiKey();
      if (!key) return { ...EMPTY_RESULT, note: "ANTHROPIC_API_KEY is not set" };
      const shown: LlmReconcileInput = {
        title: input.title,
        artist: input.artist,
        album: input.album ?? null,
        year: input.year ?? null,
        sources: (input.evidence ?? []).map((e) => ({
          source: e.source,
          tags: e.tags.map((t) => ({ genre: t.genre, ...(t.subgenre ? { subgenre: t.subgenre } : {}), confidence: Math.round(t.confidence * 100) / 100 })),
          ...(e.moods?.length ? { moods: e.moods } : {}),
        })),
      };
      const modelId = model();
      const cacheKey = `llm:${modelId}:${createHash("sha1").update(JSON.stringify(shown)).digest("hex")}`;
      try {
        let answer = (await cache.get(cacheKey)) as ToolInput | undefined;
        if (answer === undefined) {
          const res = await fetcher("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({
              model: modelId,
              max_tokens: 400,
              system: [
                { type: "text", text: SYSTEM },
                { type: "text", text: `Taxonomy (genre: subgenres):\n${taxonomyPrompt()}\n\nAllowed moods: ${moodIds().join(", ")}`, cache_control: { type: "ephemeral" } },
              ],
              tools: [toolSchema()],
              tool_choice: { type: "tool", name: TOOL_NAME },
              messages: [{ role: "user", content: JSON.stringify(shown) }],
            }),
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) return { ...EMPTY_RESULT, note: `the model answered ${res.status}` };
          const data = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
          const block = data.content?.find((c) => c.type === "tool_use" && c.name === TOOL_NAME);
          if (!block) return { ...EMPTY_RESULT, note: "the model gave no answer" };
          answer = block.input as ToolInput;
          await cache.set(cacheKey, "llm", answer, CACHE_TTL_MS);
        }
        const { tags, moods, reason } = validateReconcile(answer, now());
        return { tags, moods, note: tags.length === 0 ? `the model did not guess${reason ? `: ${reason}` : ""}` : reason || undefined };
      } catch (err) {
        return { ...EMPTY_RESULT, note: `the model call failed (${err instanceof Error ? err.name : "error"})` };
      }
    },
  };
}
