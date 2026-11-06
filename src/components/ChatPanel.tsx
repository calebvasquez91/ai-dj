"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { buildChatContext, type ChatMessage } from "@/lib/chat";
import { Button, Chip, Text } from "@/ui";

const STARTERS = ["What should I play next?", "Build me a chill set", "How will the next mix sound?"];

/**
 * The AI DJ chat, in the Now Playing sheet. Each message goes to /api/dj/chat with what is playing and queued, so the
 * DJ can talk about the actual set. It only talks: it cannot play or change anything. The conversation lives in this
 * component (kept mounted while the sheet is) and is not saved anywhere.
 */
export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, pending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setError(null);
    setPending(true);
    try {
      const { currentTrack, queue, trackAnalysis } = useStore.getState();
      const res = await fetch("/api/dj/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next, context: buildChatContext(currentTrack, queue, trackAnalysis) }),
      });
      const data = (await res.json().catch(() => null)) as { reply?: string; error?: string } | null;
      if (!res.ok || !data?.reply) {
        setError(data?.error ?? "The AI DJ couldn't be reached. Try again.");
        return;
      }
      setMessages([...next, { role: "assistant", content: data.reply }]);
    } catch {
      setError("The AI DJ couldn't be reached. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Chat with the AI DJ">
      <div className="flex min-h-40 flex-col gap-2" role="log" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3">
            <Text variant="secondary">Ask the AI DJ what to play next, how a mix will go, or for a set idea.</Text>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <Chip key={s} onClick={() => void send(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-8 self-end rounded-2xl rounded-br-sm bg-surface-raised px-3 py-2 text-sm text-foreground"
                : "mr-8 self-start rounded-2xl rounded-bl-sm border border-border-subtle bg-surface px-3 py-2 text-sm text-foreground"
            }
          >
            <span className="sr-only">{m.role === "user" ? "You: " : "AI DJ: "}</span>
            <span className="whitespace-pre-wrap break-words">{m.content}</span>
          </div>
        ))}
        {pending && <Text variant="caption">The AI DJ is thinking…</Text>}
        {error && (
          <p role="alert" className="text-xs text-accent-pink">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="flex items-center gap-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          type="text"
          aria-label="Message the AI DJ"
          placeholder="Ask the AI DJ…"
          maxLength={2000}
          autoComplete="off"
          enterKeyHint="send"
          // 16px: iOS Safari zooms the whole page when a field under 16px takes focus.
          className="min-h-11 min-w-0 flex-1 rounded-full bg-surface-raised px-4 text-base text-foreground outline-none placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent"
        />
        <Button type="submit" variant="primary" disabled={pending || !draft.trim()}>
          Send
        </Button>
      </form>
    </section>
  );
}
