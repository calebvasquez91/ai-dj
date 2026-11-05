"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DESKTOP_MEDIA_QUERY, TABLET_MEDIA_QUERY } from "@/lib/viewport";

/** Whether a media query matches, tracking resizes and rotation; false on the server (so the phone layout renders first). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** True from the desktop width up (1024px). */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_MEDIA_QUERY);
}

/** True below the tablet width (600px): the phone layout. True on the server, where nothing can be measured. */
export function useIsPhone(): boolean {
  return !useMediaQuery(TABLET_MEDIA_QUERY);
}
