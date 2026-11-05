"use client";

import { useEffect } from "react";
import { useTheme } from "@/lib/theme";

/**
 * The inline script in app/layout.tsx already sets data-theme before first paint (reading localStorage directly, to
 * avoid a flash of the wrong theme). This re-applies it from the now-hydrated store once React mounts, as a safety net,
 * and follows the device's light/dark setting while the preference is "System". Zustand's persist rehydration restores
 * `preference` silently without touching the DOM, so something has to do this at least once.
 */
export function ThemeInit() {
  useEffect(() => {
    useTheme.getState().syncTheme();
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (useTheme.getState().preference === "system") useTheme.getState().syncTheme();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return null;
}
