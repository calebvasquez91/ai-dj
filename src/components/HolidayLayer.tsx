"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { activeHolidayTheme } from "@/lib/holidayThemes";
import { HolidayParticles } from "@/components/HolidayParticles";

/**
 * While a playlist with a holiday theme is the one playing: tints the app's accent gradient (the play button, the progress fill) and runs the
 * theme's light particle effect. Spooky Music is never a holiday playlist (activeHolidayTheme says no for a system playlist), so its own look is
 * untouched; with no holiday playlist active this renders nothing and changes nothing.
 */
export function HolidayLayer() {
  const theme = useStore((s) => activeHolidayTheme(s.playlists.find((p) => p.id === s.activePlaylistId)));

  useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    root.dataset.holiday = theme.id;
    root.style.setProperty("--accent-gradient", `linear-gradient(135deg, ${theme.accent.from}, ${theme.accent.to})`);
    return () => {
      delete root.dataset.holiday;
      root.style.removeProperty("--accent-gradient");
    };
  }, [theme]);

  return theme ? <HolidayParticles theme={theme} /> : null;
}
