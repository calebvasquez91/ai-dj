"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";

/** Fetches the signed-in user's track library from the server once on mount. Renders nothing. */
export function AppDataLoader() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void useStore.getState().loadLibrary();
    void useStore.getState().loadPlaylists();
  }, []);

  return null;
}
