/**
 * Liked songs, kept on this device (localStorage) as a list of track ids. There is no server side to it: the app's API
 * and database have no like, so a like follows the browser, not the account. A small standalone persisted store, like
 * lib/theme.ts, so the main store's shape is untouched.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export const LIKED_STORAGE_KEY = "ai-dj:liked";

/** The list with `id` added at the front if it was not there, or removed if it was. */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [id, ...ids];
}

export interface LikedState {
  /** Newest like first. */
  ids: string[];
  toggle: (id: string) => void;
}

function createLikedState(set: (fn: (s: LikedState) => Partial<LikedState>) => void): LikedState {
  return { ids: [], toggle: (id) => set((s) => ({ ids: toggleId(s.ids, id) })) };
}

export const useLiked =
  typeof window !== "undefined"
    ? create<LikedState>()(
        persist((set) => createLikedState(set), {
          name: LIKED_STORAGE_KEY,
          storage: createJSONStorage(() => window.localStorage),
          partialize: (s) => ({ ids: s.ids }),
        })
      )
    : create<LikedState>()((set) => createLikedState(set));
