/**
 * The one Claude Haiku call the DJ makes when two transition plans are too close to call (lib/transitionChoice.ts). Server-only: it reads
 * process.env.ANTHROPIC_API_KEY, which never reaches the browser. JSON-schema output (a forced tool call), the long fixed instructions cached
 * (prompt caching), a 2-second timeout, and the never-throws contract: any problem gives null and the DJ keeps its local winner.
 */
import { HAIKU_CALL_TIMEOUT_MS, parsePickAnswer, type PickAnswer, type PickRequest } from "@/lib/transitionChoice";

/** A small, fast model: this is a two-way choice and a sentence. A current id (CLAUDE.md), not a dated snapshot. */
export const DJ_PICK_MODEL = "claude-haiku-5-5";

const SYSTEM = [
  "You are the DJ in a two-person booth. The Audio Engineer has already ruled out anything that would sound bad and sent you two candidate transitions for the next pair of songs.",
  "Pick exactly one of the two candidates by its `style` and write ONE short sentence (under 25 words) saying why, in plain DJ language.",
  "Weigh the genre pair, the Engineer's mixability score and constraints, the energy at the two mix points and any vocal density. Never invent a style that is not one of the two candidates.",
].join("\n");

const PICK_TOOL = {
  name: "pick_transition",
  description: "Choose one of the two candidate transitions and give a one-sentence reason.",
  input_schema: {
    type: "object",
    properties: {
      style: { type: "string", description: "The style of the chosen candidate, exactly as offered." },
      reason: { type: "string", description: "One short sentence explaining the choice." },
    },
    required: ["style", "reason"],
    additionalProperties: false,
  },
} as const;

export async function askHaikuToPick(request: PickRequest): Promise<PickAnswer | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: DJ_PICK_MODEL,
        max_tokens: 200,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: [PICK_TOOL],
        tool_choice: { type: "tool", name: PICK_TOOL.name },
        messages: [{ role: "user", content: JSON.stringify(request) }],
      }),
      signal: AbortSignal.timeout(HAIKU_CALL_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[transition-pick] Anthropic API returned ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const block = data.content?.find((b) => b.type === "tool_use");
    return parsePickAnswer(block?.input, request.candidates.map((c) => c.style));
  } catch (err) {
    console.warn("[transition-pick] Anthropic call failed, keeping the local winner:", err instanceof Error ? err.message : err);
    return null;
  }
}
