/**
 * Reading a playlist request with Claude Haiku: the sentence in, a structured spec out, through a tool call whose schema
 * fixes the shape (genre labels are an enum of the taxonomy's, so the model cannot invent one; moods and arcs likewise).
 * The answer is still run through validateSpec (spec.ts) by the caller, which maps or drops anything that slipped through
 * and turns a request with nothing usable into one clarifying question. Returns null when there is no key or the call fails,
 * and the caller falls back to the local reader. Server-only; the key is ANTHROPIC_API_KEY.
 */
import { genreLabels, GENRES } from "@/lib/genres";
import { moodIds } from "@/lib/moodTags";
import { ENERGY_ARCS, PROFILES } from "@/lib/curate/profiles";
import { GENRE_LLM_MODEL, taxonomyPrompt } from "@/lib/genre/llmReconciler";
import type { Fetcher } from "@/lib/genre/types";

const TOOL = "build_playlist_spec";

const SYSTEM = `You turn one playlist request into a structured spec for a DJ app's library.
Use only the genres, subgenres and moods the app knows; never invent one. If the person uses a word for something the taxonomy has under another name, use the taxonomy's name.
Put a decade as eraRange (the 90s is 1990 to 1999). Put a stated tempo as bpmRange. Put a stated length as targetLengthMinutes.
Set explicitPolicy to "clean-only" only if they ask for clean, radio-friendly or family-friendly music; otherwise leave it out.
Set profile to the occasion if one is named (a workout, a dinner party, a wedding...) and energyArc only if they describe how the energy should move.
If the request names no genre, mood, decade, tempo or occasion at all, give no filters and put one short question in "clarification" that would let you build it. Otherwise leave "clarification" out.
Do not ask more than one question. Do not quote lyrics.`;

export function specToolSchema() {
  const subgenres = GENRES.flatMap((g) => g.subgenres.map((s) => s.label)).filter((v, i, a) => a.indexOf(v) === i);
  return {
    name: TOOL,
    description: "Report the playlist spec for the request.",
    input_schema: {
      type: "object",
      properties: {
        genres: { type: "array", maxItems: 6, items: { type: "string", enum: [...genreLabels()] } },
        subgenres: { type: "array", maxItems: 8, items: { type: "string", enum: subgenres } },
        moods: { type: "array", maxItems: 5, items: { type: "string", enum: moodIds() } },
        eraRange: { type: "object", properties: { from: { type: "integer" }, to: { type: "integer" } }, required: ["from", "to"] },
        bpmRange: { type: "object", properties: { min: { type: "integer" }, max: { type: "integer" } }, required: ["min", "max"] },
        energyArc: { type: "string", enum: [...ENERGY_ARCS] },
        explicitPolicy: { type: "string", enum: ["any", "clean-only"] },
        targetLengthMinutes: { type: "integer", minimum: 5 },
        profile: { type: "string", enum: Object.keys(PROFILES) },
        clarification: { type: "string" },
      },
      required: ["genres", "subgenres", "moods"],
    },
  };
}

export interface LlmSpecOptions {
  fetcher: Fetcher;
  apiKey: () => string | undefined;
  model?: () => string;
}

/** The model's raw spec for `request`, or null. */
export async function parseRequestWithLlm(request: string, { fetcher, apiKey, model = () => process.env.GENRE_LLM_MODEL || GENRE_LLM_MODEL }: LlmSpecOptions): Promise<unknown | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const res = await fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: model(),
        max_tokens: 500,
        system: [
          { type: "text", text: SYSTEM },
          { type: "text", text: `Taxonomy (genre: subgenres):\n${taxonomyPrompt()}\n\nMoods: ${moodIds().join(", ")}`, cache_control: { type: "ephemeral" } },
        ],
        tools: [specToolSchema()],
        tool_choice: { type: "tool", name: TOOL },
        messages: [{ role: "user", content: request.slice(0, 500) }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
    return data.content?.find((c) => c.type === "tool_use" && c.name === TOOL)?.input ?? null;
  } catch {
    return null;
  }
}
