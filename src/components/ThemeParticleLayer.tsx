"use client";

import { HolidayParticles } from "@/components/HolidayParticles";
import { activeHolidayTheme } from "@/lib/holidayThemes";
import { useStore } from "@/lib/store";

/**
 * The light particles of the playlist's holiday theme (the GTA6 cars and money, snow, hearts, and so on), as a background layer of the Now Playing panel: they fill the
 * panel, sit beneath its words and images, and a custom theme's run only while a song plays. Renders nothing when the playing playlist has no holiday theme.
 */
export function ThemeParticleLayer() {
  const theme = useStore((s) => activeHolidayTheme(s.playlists.find((p) => p.id === s.activePlaylistId)));
  const playing = useStore((s) => s.isPlaying);
  return theme && (!theme.onlyWhilePlaying || playing) ? <HolidayParticles theme={theme} /> : null;
}
