"use client";

import { useEffect } from "react";
import { applyThemeToDocument, useTheme } from "@/lib/theme";

/**
 * The inline script in app/layout.tsx already sets data-theme before first
 * paint (reading localStorage directly, to avoid a flash of the wrong
 * theme) — this just re-applies it from the now-hydrated store once React
 * mounts, as a cheap safety net in case that script didn't run for some
 * reason. Zustand's persist rehydration restores `theme` silently without
 * touching the DOM, so something has to do this at least once.
 */
export function ThemeInit() {
  useEffect(() => {
    applyThemeToDocument(useTheme.getState().theme);
  }, []);
  return null;
}
