/**
 * One request to Claude that expects a JSON object back, with the never-throws contract the AI DJ modules share: a
 * missing API key, an HTTP error, a timeout, a thrown fetch or an answer with no JSON all give null, and the caller
 * falls back to its own local rule. Server-only (reads process.env.ANTHROPIC_API_KEY).
 *
 * lib/ai-fx-plan.ts uses it; lib/ai-dj.ts, lib/ai-fx.ts and lib/ai-sync.ts still carry their own copies of this
 * boilerplate and can move onto it one at a time.
 */
import { extractJsonObject } from "@/lib/json-extract";

/** The model every AI DJ call uses (a current, non-deprecated id, per CLAUDE.md). */
export const AI_DJ_MODEL = "claude-sonnet-5";

export interface ClaudeJsonRequest {
  system: string;
  /** Sent as the user message, JSON-encoded. */
  user: unknown;
  maxTokens: number;
  timeoutMs: number;
  /** Prefix for the warnings logged on failure, e.g. "ai-fx-plan". */
  label: string;
}

export async function askClaudeForJson({ system, user, maxTokens, timeoutMs, label }: ClaudeJsonRequest): Promise<unknown | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: AI_DJ_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: JSON.stringify(user) }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.warn(`[${label}] Anthropic API returned ${res.status}: ${await res.text().catch(() => "")}`);
      return null;
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      console.warn(`[${label}] Anthropic response had no text content block`);
      return null;
    }
    const parsed = extractJsonObject(text);
    if (parsed == null) {
      console.warn(`[${label}] Claude returned no JSON: ${text.slice(0, 200)}`);
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn(`[${label}] Anthropic call failed, falling back:`, err);
    return null;
  }
}
