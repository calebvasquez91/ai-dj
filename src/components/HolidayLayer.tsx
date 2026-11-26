"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { activeHolidayTheme } from "@/lib/holidayThemes";

/**
 * While a playlist with a holiday theme is the one playing: tints the app's accent gradient (the play button, the progress fill) and sets the theme's light colours
 * (which the Now Playing visualizer reads). The theme's light particles are NOT drawn here any more: they are part of the Now Playing visualizer background
 * (components/ThemeParticleLayer.tsx), so nothing is ever painted over the page's words or images. Spooky Music is never a holiday playlist (activeHolidayTheme says no
 * for a system playlist), so its own look is untouched; with no holiday playlist active this changes nothing.
 */
export function HolidayLayer() {
  const theme = useStore((s) => activeHolidayTheme(s.playlists.find((p) => p.id === s.activePlaylistId)));

  useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    root.dataset.holiday = theme.id;
    root.style.setProperty("--accent-gradient", `linear-gradient(135deg, ${theme.accent.from}, ${theme.accent.to})`);
    if (theme.lights) {
      root.style.setProperty("--wave-bar-low", theme.lights.low);
      root.style.setProperty("--wave-bar-mid", theme.lights.mid);
      root.style.setProperty("--wave-bar-high", theme.lights.high);
    }
    return () => {
      delete root.dataset.holiday;
      root.style.removeProperty("--accent-gradient");
      root.style.removeProperty("--wave-bar-low");
      root.style.removeProperty("--wave-bar-mid");
      root.style.removeProperty("--wave-bar-high");
    };
  }, [theme]);

  return null;
}
