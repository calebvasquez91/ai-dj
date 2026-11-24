"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { activeHolidayTheme } from "@/lib/holidayThemes";
import { HolidayParticles } from "@/components/HolidayParticles";

/**
 * While a playlist with a holiday theme is the one playing: tints the app's accent gradient (the play button, the progress fill), recolours the
 * ambient equalizer bars when the theme has its own lights, and runs the theme's light particle effect (a custom theme's only while a song plays). Spooky Music is never a holiday playlist (activeHolidayTheme says no for a system playlist), so its own look is
 * untouched; with no holiday playlist active this renders nothing and changes nothing.
 */
export function HolidayLayer() {
  const theme = useStore((s) => activeHolidayTheme(s.playlists.find((p) => p.id === s.activePlaylistId)));
  const playing = useStore((s) => s.isPlaying);

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

  return theme && (!theme.onlyWhilePlaying || playing) ? <HolidayParticles theme={theme} /> : null;
}
