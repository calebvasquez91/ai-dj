"use client";

import { useState } from "react";
import { CoverMosaic } from "@/ui";
import type { Playlist } from "@/types/music";

/**
 * A playlist's cover: its own picture when it has one (and it loads), else the mosaic of its songs' covers. A picture that fails to load
 * falls back to the mosaic, so a card is never broken. Fills its parent. System playlists (Spooky Music) never show a picture.
 */
export function PlaylistCover({ playlist }: { playlist: Pick<Playlist, "name" | "tracks" | "imageUrl" | "theme"> }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = playlist.theme ? undefined : playlist.imageUrl;
  if (url && url !== failedUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- the picture is already small and may be a data address; the mosaic is the fallback if it fails
      <img src={url} alt={playlist.name} loading="lazy" onError={() => setFailedUrl(url)} className="h-full w-full rounded-lg object-cover" />
    );
  }
  return <CoverMosaic title={playlist.name} items={playlist.tracks.map((t) => ({ title: t.title, src: t.thumbnailUrl }))} />;
}
