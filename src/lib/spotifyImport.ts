// Orchestrates a Spotify playlist import — mirrors youtubeImport.ts.
import { listPlaylistTracks, type SpotifyImportedTrack } from "@/lib/spotifyApi";
import type { Track } from "@/types/music";

export interface ImportResult {
  tracks: Track[];
  importedCount: number;
  /** Tracks already imported previously (server-side skipDuplicates) or duplicated across the selected playlists. */
  skippedCount: number;
}

export async function importPlaylists(playlistIds: string[]): Promise<ImportResult> {
  const perPlaylist = await Promise.all(playlistIds.map((id) => listPlaylistTracks(id)));

  const deduped = new Map<string, SpotifyImportedTrack>();
  for (const tracks of perPlaylist) {
    for (const track of tracks) {
      if (!deduped.has(track.spotifyTrackId)) deduped.set(track.spotifyTrackId, track);
    }
  }
  const items = Array.from(deduped.values());
  if (items.length === 0) return { tracks: [], importedCount: 0, skippedCount: 0 };

  const res = await fetch("/api/tracks/spotify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tracks: items }),
  });
  if (!res.ok) throw new Error("Failed to save imported tracks.");
  const tracks = (await res.json()) as Track[];
  return { tracks, importedCount: tracks.length, skippedCount: items.length - tracks.length };
}
