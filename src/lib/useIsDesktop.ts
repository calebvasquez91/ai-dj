"use client";

import { useSyncExternalStore } from "react";
import { DESKTOP_MEDIA_QUERY } from "@/lib/viewport";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True at the desktop breakpoint, tracking resizes and rotation; false on the server (phone layout first). */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_MEDIA_QUERY).matches,
    () => false,
  );
}
