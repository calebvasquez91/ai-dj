// Orchestrates a YouTube playlist import: fetch items (client-side, via the
// user's own OAuth token) from every selected playlist, dedupe by video id,
// then persist the resulting metadata through our own API — mirrors
// localAudio.ts's filesToTracks() as the ingestion path for this source.
import { listPlaylistItemsWithDuration, type YouTubeImportedTrack } from "@/lib/youtubeApi";
import type { Track } from "@/types/music";

export interface ImportResult {
  tracks: Track[];
  importedCount: number;
  /** Videos already imported previously (server-side skipDuplicates) or duplicated across the selected playlists. */
  skippedCount: number;
}

export async function importPlaylists(playlistIds: string[]): Promise<ImportResult> {
  const perPlaylist = await Promise.all(playlistIds.map((id) => listPlaylistItemsWithDuration(id)));

  const deduped = new Map<string, YouTubeImportedTrack>();
  for (const items of perPlaylist) {
    for (const item of items) {
      if (!deduped.has(item.videoId)) deduped.set(item.videoId, item);
    }
  }
  const items = Array.from(deduped.values());
  if (items.length === 0) return { tracks: [], importedCount: 0, skippedCount: 0 };

  const res = await fetch("/api/tracks/youtube", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tracks: items }),
  });
  if (!res.ok) throw new Error("Failed to save imported tracks.");
  const tracks = (await res.json()) as Track[];
  return { tracks, importedCount: tracks.length, skippedCount: items.length - tracks.length };
}
