/**
 * The app's side of genre classification: how much is waiting, which tracks have a job, and the actions (Re-classify, a
 * person's own genres, the review screen's bulk buttons). It is its own small store, apart from the library store, and it
 * writes the genre fields it learns back onto the library's tracks so every screen sees them.
 *
 * The background runner is simply: while a person has jobs waiting, ask the server to work a few (POST /api/genre/run),
 * then look again. The server does the heavy work and holds the provider rate limits; this only keeps asking.
 */
import { create } from "zustand";
import { useStore } from "@/lib/store";
import type { GenreStatus, GenreTag, Track } from "@/types/music";

export type GenreJobState = "queued" | "running" | "failed";

/** The genre fields the server sends for a track (src/lib/genre/api.ts). */
export interface TrackGenreFields {
  genreTags: GenreTag[];
  genreStatus: GenreStatus;
  genre?: string;
  subgenres: string[];
  moods: string[];
  genreDisagrees?: boolean;
}

export interface GenreStatusSnapshot {
  ready: boolean;
  queued: number;
  running: number;
  failed: number;
  needsReview: number;
  unclassified: number;
  jobs: Record<string, GenreJobState>;
}

interface GenreClientState extends GenreStatusSnapshot {
  /** The genre fields of each track the server has classified, by track id (O(1) for a card to read). */
  fields: Record<string, TrackGenreFields>;
  /** Whether a status call has come back yet (so the UI does not flash "not set up"). */
  loaded: boolean;
  draining: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Works the queue until nothing is waiting (or the server says it is not set up, or an error). */
  drain: () => Promise<void>;
  /** Queues the genre run for tracks, or a playlist, and starts working on it. */
  reclassify: (target: { trackIds: string[] } | { playlistId: string }) => Promise<void>;
  /** Queues every track that has never been classified (low priority). */
  backfill: () => Promise<void>;
  setGenres: (trackId: string, picks: { genre: string; subgenre?: string }[]) => Promise<boolean>;
  clearGenres: (trackId: string) => Promise<boolean>;
  acceptAbove: (minConfidence?: number) => Promise<number>;
  confirmTracks: (trackIds: string[]) => Promise<number>;
}

const EMPTY: GenreStatusSnapshot = { ready: false, queued: 0, running: 0, failed: 0, needsReview: 0, unclassified: 0, jobs: {} };
/** Wait between runs so the page and the server are not hammered while the queue drains. */
const DRAIN_PAUSE_MS = 1500;
const MAX_DRAIN_ROUNDS = 400;

/** Writes the given genre fields onto the matching library tracks. */
export function applyGenreFields(fields: Record<string, TrackGenreFields>) {
  const ids = Object.keys(fields);
  if (ids.length === 0) return;
  useStore.setState((s) => ({ localLibrary: s.localLibrary.map((t): Track => (fields[t.id] ? { ...t, ...fields[t.id] } : t)) }));
  useGenreClient.setState((s) => ({ fields: { ...s.fields, ...fields } }));
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Reads every classified track's genre fields from the server into the library and the genre store. */
export async function pullFields() {
  try {
    const res = await fetch("/api/genre/fields");
    if (!res.ok) return;
    const fields = await readJson<Record<string, TrackGenreFields>>(res);
    if (fields) applyGenreFields(fields);
  } catch {
    // The next refresh will try again.
  }
}

export const useGenreClient = create<GenreClientState>()((set, get) => ({
  ...EMPTY,
  fields: {},
  loaded: false,
  draining: false,
  error: null,

  refresh: async () => {
    try {
      const res = await fetch("/api/genre/status");
      if (!res.ok) return;
      const snap = await readJson<GenreStatusSnapshot>(res);
      if (snap) set({ ...snap, loaded: true });
    } catch {
      // Offline or the server restarting: leave the last numbers.
    }
  },

  drain: async () => {
    if (get().draining) return;
    set({ draining: true, error: null });
    try {
      await get().refresh();
      for (let round = 0; round < MAX_DRAIN_ROUNDS; round++) {
        const s = get();
        if (!s.ready || s.queued + s.running === 0) break;
        const res = await fetch("/api/genre/run", { method: "POST" });
        if (!res.ok) {
          set({ error: "Genre classification could not run." });
          break;
        }
        const run = await readJson<{ ready: boolean; processed: number; more: boolean }>(res);
        await get().refresh();
        if (run?.processed) await pullFields();
        if (!run?.ready) break;
        // Nothing left that is due (the rest are waiting out a retry delay): stop and let a later refresh pick them up.
        if (!run.more && run.processed === 0) break;
        await new Promise((r) => setTimeout(r, DRAIN_PAUSE_MS));
      }
      await pullFields();
    } finally {
      set({ draining: false });
    }
  },

  reclassify: async (target) => {
    try {
      const res = await fetch("/api/genre/enqueue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(target) });
      if (!res.ok) {
        const body = await readJson<{ error?: string }>(res);
        set({ error: body?.error ?? "Could not queue the genre run." });
        return;
      }
      await get().refresh();
      void get().drain();
    } catch {
      set({ error: "Could not queue the genre run." });
    }
  },

  backfill: async () => {
    try {
      const res = await fetch("/api/genre/enqueue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "unclassified" }) });
      if (res.ok) await get().refresh();
    } catch {
      // Best effort; it will be tried again next session.
    }
  },

  setGenres: async (trackId, picks) => {
    try {
      const res = await fetch(`/api/tracks/${trackId}/genre`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ picks }) });
      const body = await readJson<TrackGenreFields & { error?: string }>(res);
      if (!res.ok || !body) {
        set({ error: body?.error ?? "Could not save the genres." });
        return false;
      }
      applyGenreFields({ [trackId]: body });
      await get().refresh();
      return true;
    } catch {
      set({ error: "Could not save the genres." });
      return false;
    }
  },

  clearGenres: async (trackId) => {
    try {
      const res = await fetch(`/api/tracks/${trackId}/genre`, { method: "DELETE" });
      const body = await readJson<TrackGenreFields & { error?: string }>(res);
      if (!res.ok || !body) {
        set({ error: body?.error ?? "Could not reset the genres." });
        return false;
      }
      applyGenreFields({ [trackId]: body });
      await get().refresh();
      return true;
    } catch {
      set({ error: "Could not reset the genres." });
      return false;
    }
  },

  acceptAbove: async (minConfidence = 0.4) => bulkReview({ action: "accept-above", minConfidence }),
  confirmTracks: async (trackIds) => bulkReview({ action: "confirm", trackIds }),
}));

async function bulkReview(body: object): Promise<number> {
  try {
    const res = await fetch("/api/genre/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const out = await readJson<{ changed: number; remaining: number; error?: string }>(res);
    if (!res.ok || !out) {
      useGenreClient.setState({ error: out?.error ?? "Could not update the genres." });
      return 0;
    }
    await pullFields();
    await useGenreClient.getState().refresh();
    return out.changed;
  } catch {
    useGenreClient.setState({ error: "Could not update the genres." });
    return 0;
  }
}
