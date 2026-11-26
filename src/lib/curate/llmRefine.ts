/**
 * The model's part in a playlist, after the tracks are chosen: put them in a good order and write a short title and
 * description. It is shown only the chosen tracks (title, artist, genre, a rough energy and tempo) in their planned order
 * and asked to keep them all; the filtering, scoring and energy plan are local and have already happened. Its answer goes
 * through refineOrder (curate.ts), which accepts a new order only if it is exactly the same tracks and adds no key clash, so the model can
 * reorder and describe but never add or drop one. Returns null with no key or on any failure. Server-only.
 */
import { askClaudeForJson } from "@/lib/anthropicJson";
import type { CurationPreview } from "@/lib/curate/curate";

const SYSTEM = `You are an AI DJ finishing a playlist. The tracks are already chosen and ordered by an energy plan.
Return JSON only: {"title": string, "description": string, "order": string[]}.
"order" must contain every track id exactly once; improve the flow (energy, tempo, mood) without breaking the energy arc the plan follows. If the order is already good, return it unchanged.
Where a track has a "key" (a Camelot code such as 8A), the plan has kept neighbouring keys compatible (the same code, the other letter on the same number, or one number up or down with the same letter): keep it that way, and never put clashing keys next to each other. A track with a null key has no key to keep.
"title" is at most 6 words. "description" is one or two plain sentences, no markup, no quotes from lyrics.`;

export async function refineWithClaude(request: string, preview: CurationPreview): Promise<unknown | null> {
  if (preview.tracks.length < 4) return null;
  return askClaudeForJson({
    system: SYSTEM,
    user: {
      request: request.slice(0, 500),
      arc: preview.arc,
      occasion: preview.profile,
      tracks: preview.tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist, genre: t.genre ?? null, energy: Math.round(t.energy * 100) / 100, bpm: t.bpm ? Math.round(t.bpm) : null, key: t.camelot ?? null })),
    },
    maxTokens: 1500,
    timeoutMs: 20_000,
    label: "curate",
  });
}
