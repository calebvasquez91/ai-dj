/**
 * The AI DJ chat's one call to the Anthropic API. Server-only (it reads process.env.ANTHROPIC_API_KEY): called from
 * app/api/dj/chat/route.ts, the same shape as lib/ai-fx.ts. A missing key, a network error, a timeout or an unusable
 * response gives a plain "can't answer right now" reply instead of a thrown error, so the chat never breaks the page.
 */
import { buildChatSystemPrompt, type ChatContext, type ChatMessage } from "@/lib/chat";

const MODEL = "claude-sonnet-5";
const ANTHROPIC_TIMEOUT_MS = 20000;
const MAX_REPLY_TOKENS = 400;

export interface ChatReply {
  reply: string;
  /** True when this is the stock message, not a model answer. */
  usedFallback: boolean;
}

export const FALLBACK_REPLY = "The AI DJ can't answer right now. Give it a moment and try again.";

export async function chatWithDj(messages: ChatMessage[], context: ChatContext): Promise<ChatReply> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { reply: FALLBACK_REPLY, usedFallback: true };

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
        max_tokens: MAX_REPLY_TOKENS,
        system: buildChatSystemPrompt(context),
        messages,
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[ai-chat] Anthropic API returned ${res.status}: ${await res.text().catch(() => "")}`);
      return { reply: FALLBACK_REPLY, usedFallback: true };
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((block) => block.type === "text")?.text?.trim();
    if (!text) {
      console.warn("[ai-chat] Anthropic response had no text content block", JSON.stringify(data));
      return { reply: FALLBACK_REPLY, usedFallback: true };
    }
    return { reply: text, usedFallback: false };
  } catch (err) {
    console.warn("[ai-chat] Anthropic call failed, falling back:", err);
    return { reply: FALLBACK_REPLY, usedFallback: true };
  }
}
