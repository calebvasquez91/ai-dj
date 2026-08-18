"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { getAudioFile } from "@/lib/audioDb";

/**
 * Local tracks are persisted as metadata (title/artist/duration/etc) in
 * localStorage, but their `sourceUrl` is a `blob:` URL that dies the moment
 * the tab closes. The actual audio bytes live in IndexedDB (see
 * lib/audioDb.ts). On mount, this component walks every track currently in
 * the store, pulls its bytes back out of IndexedDB, mints a fresh blob URL,
 * and patches it into the store — so previously-added songs just work
 * again without the user re-picking files.
 */
export function AudioHydrator() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const state = useStore.getState();
      const ids = new Set<string>();
      state.localLibrary.forEach((t) => ids.add(t.id));
      state.playlists.forEach((p) => p.tracks.forEach((t) => ids.add(t.id)));

      if (ids.size === 0) {
        useStore.getState().setAudioHydrated(true);
        return;
      }

      const urls: Record<string, string> = {};
      await Promise.all(
        Array.from(ids).map(async (id) => {
          try {
            const blob = await getAudioFile(id);
            if (blob) urls[id] = URL.createObjectURL(blob);
          } catch {
            // IndexedDB unavailable or entry missing — that track will just
            // show up without a working source until re-added.
          }
        })
      );

      if (Object.keys(urls).length > 0) {
        useStore.getState().setTrackSourceUrls(urls);
      }
      useStore.getState().setAudioHydrated(true);
    })();
  }, []);

  return null;
}
