"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { loadPalette, paletteFromPixels, savePalette, waveformColors, type WaveformColors } from "@/lib/waveformColors";

/** Reads a cover's colours: draws it small and hands the pixels to paletteFromPixels. Null when the picture cannot be read (it does not load, or is not allowed to be read). */
function paletteFromImage(url: string): Promise<WaveformColors | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        resolve(paletteFromPixels(ctx.getImageData(0, 0, size, size).data));
      } catch {
        resolve(null); // a cover the browser will not let us read
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * The colours for a song's waveform: the app's own by default; the cover's colours only when this song has a cover (worked out once and
 * remembered per song); and the playing playlist's holiday theme over both. Spooky Music's waveform is decided by the deck itself (its own
 * classes), never here.
 */
export function useWaveformColors(track: { id: string; thumbnailUrl?: string | null } | null): WaveformColors {
  const playlist = useStore((s) => s.playlists.find((p) => p.id === s.activePlaylistId) ?? null);
  const trackId = track?.id ?? null;
  const coverUrl = track?.thumbnailUrl ?? null;
  const [coverPalette, setCoverPalette] = useState<WaveformColors | null>(null);

  useEffect(() => {
    if (!trackId || !coverUrl) {
      setCoverPalette(null); // eslint-disable-line react-hooks/set-state-in-effect -- no cover: back to the default colours
      return;
    }
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    const remembered = loadPalette(storage, trackId);
    if (remembered !== undefined) {
      setCoverPalette(remembered);
      return;
    }
    let cancelled = false;
    void paletteFromImage(coverUrl).then((palette) => {
      savePalette(storage, trackId, palette);
      if (!cancelled) setCoverPalette(palette);
    });
    return () => {
      cancelled = true;
    };
  }, [trackId, coverUrl]);

  return waveformColors({ playlist, coverPalette });
}
