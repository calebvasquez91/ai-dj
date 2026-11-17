"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { pullFields, useGenreClient } from "@/lib/genreClient";

/**
 * Keeps genre classification going in the background while the app is open: once the library has loaded (and again when
 * it grows, after an upload or an import) it looks at what is waiting, queues the tracks that were never classified at low
 * priority (once a session), and asks the server to work through the queue. Renders nothing. The heavy work and the
 * provider rate limits are the server's; this only keeps asking.
 */
export function GenreRunner() {
  const libraryLoaded = useStore((s) => s.libraryLoaded);
  const trackCount = useStore((s) => s.localLibrary.length);
  const backfilled = useRef(false);

  useEffect(() => {
    if (!libraryLoaded) return;
    // A moment's pause so a burst of uploads is queued together, not one run per file.
    const timer = setTimeout(async () => {
      const genre = useGenreClient.getState();
      await genre.refresh();
      const snapshot = useGenreClient.getState();
      if (!snapshot.ready) return;
      await pullFields();
      if (!backfilled.current && snapshot.unclassified > 0) {
        backfilled.current = true;
        await genre.backfill();
      }
      void useGenreClient.getState().drain();
    }, 1500);
    return () => clearTimeout(timer);
  }, [libraryLoaded, trackCount]);

  return null;
}
