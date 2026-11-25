/**
 * The app's side of "Vibe Code": whether the sheet is open, and the one call to the server that turns a request into a
 * previewed playlist. Nothing is saved until the person saves it (VibeCodeSheet.tsx makes it a normal playlist).
 */
import { create } from "zustand";
import type { CurationPreview } from "@/lib/curate/curate";
import type { DiscoverSuggestion } from "@/lib/curate/discover";
import type { ListSuggestion } from "@/lib/songList";
import type { CurationSpec } from "@/lib/curate/spec";
import { GENRE_TRANSITIONS_ENABLED } from "@/lib/featureFlags";
import { useGenreTransitions } from "@/lib/genreTransitionStore";

export type CurateResult =
  | { kind: "clarification"; question: string; notes: string[] }
  | { kind: "preview"; preview: CurationPreview; discover: DiscoverSuggestion[]; fromList?: ListSuggestion[]; usedModel: { spec: boolean; refine: boolean } };

export interface CurateInput {
  request?: string;
  answer?: string;
  spec?: CurationSpec;
  seed?: number;
}

/** Asks the server to curate. Throws an Error with a plain message on failure. */
export async function requestCuration(input: CurateInput): Promise<CurateResult> {
  let res: Response;
  try {
    res = await fetch("/api/ai/curate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, genreFlow: GENRE_TRANSITIONS_ENABLED && useGenreTransitions.getState().settings.enabled }) });
  } catch {
    throw new Error("Couldn't reach Vibe Code. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as (CurateResult & { error?: string }) | null;
  if (!res.ok || !body || !("kind" in body)) throw new Error((body as { error?: string } | null)?.error ?? `Vibe Code couldn't build that (error ${res.status}).`);
  return body;
}

interface CurateUi {
  open: boolean;
  /** Starts the sheet with this request filled in (the example chips and "Vibe Code" with no text pass none). */
  initialRequest: string;
  show: (initialRequest?: string) => void;
  close: () => void;
}

export const useCurateUi = create<CurateUi>()((set) => ({
  open: false,
  initialRequest: "",
  show: (initialRequest = "") => set({ open: true, initialRequest }),
  close: () => set({ open: false }),
}));

export const EXAMPLE_REQUESTS = ["90s R&B for a workout, clean only", "late-night chill house for a dinner party", "an hour of upbeat country for a road trip", "trap bangers, 30 minutes"];
