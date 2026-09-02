// Thin client for the Spotify Web API endpoints this app needs, called
// directly from the browser with the user's own OAuth access token. Unlike
// YouTube's Data API, Spotify's playlist-tracks endpoint already includes
// duration, artist names, and album art in one call — no second batched
// lookup needed.
import { getValidSpotifyToken } from "@/lib/spotifyAuth";

const API_BASE = "https://api.spotify.com/v1";

export interface SpotifyPlaylistSummary {
  id: string;
  title: string;
  thumbnailUrl?: string;
  itemCount: number;
}

export interface SpotifyImportedTrack {
  spotifyTrackId: string;
  title: string;
  artist: string;
  durationSec: number;
  thumbnailUrl?: string;
}

async function spotifyFetch(path: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    const refreshed = await getValidSpotifyToken();
    if (!refreshed) throw new Error("Spotify session expired — reconnect your account.");
    const retry = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${refreshed}` } });
    if (!retry.ok) throw new Error(`Spotify Web API error (${retry.status}).`);
    return retry.json();
  }
  if (!res.ok) throw new Error(`Spotify Web API error (${res.status}).`);
  return res.json();
}

export async function listMyPlaylists(): Promise<SpotifyPlaylistSummary[]> {
  const token = await getValidSpotifyToken();
  if (!token) throw new Error("Not connected to Spotify.");

  const playlists: SpotifyPlaylistSummary[] = [];
  let path: string | null = "/me/playlists?limit=50";
  while (path) {
    const data = await spotifyFetch(path, token);
    const items = (data.items as Array<Record<string, unknown>>) ?? [];
    for (const item of items) {
      const images = item.images as Array<{ url?: string }> | null;
      const tracks = item.tracks as Record<string, unknown> | undefined;
      playlists.push({
        id: item.id as string,
        title: (item.name as string) ?? "Untitled playlist",
        thumbnailUrl: images?.[0]?.url,
        itemCount: (tracks?.total as number) ?? 0,
      });
    }
    const next = data.next as string | null;
    path = next ? next.slice(API_BASE.length) : null;
  }
  return playlists;
}

/** Full per-playlist fetch — Spotify's item shape already has everything needed, unlike YouTube's separate duration lookup. Filters out locally-uploaded files inside the playlist (is_local, or a null track for a removed/unavailable item) since they have no streamable URI. */
export async function listPlaylistTracks(playlistId: string): Promise<SpotifyImportedTrack[]> {
  const token = await getValidSpotifyToken();
  if (!token) throw new Error("Not connected to Spotify.");

  const tracks: SpotifyImportedTrack[] = [];
  let path: string | null = `/playlists/${playlistId}/tracks?limit=100`;
  while (path) {
    const data = await spotifyFetch(path, token);
    const items = (data.items as Array<Record<string, unknown>>) ?? [];
    for (const item of items) {
      const track = item.track as Record<string, unknown> | null;
      if (!track || track.is_local || !track.id) continue;
      const artists = (track.artists as Array<{ name?: string }>) ?? [];
      const album = track.album as Record<string, unknown> | undefined;
      const images = album?.images as Array<{ url?: string }> | undefined;
      tracks.push({
        spotifyTrackId: track.id as string,
        title: (track.name as string) ?? "Untitled track",
        artist: artists.map((a) => a.name).filter(Boolean).join(", ") || "Unknown Artist",
        durationSec: ((track.duration_ms as number) ?? 0) / 1000,
        thumbnailUrl: images?.[0]?.url,
      });
    }
    const next = data.next as string | null;
    path = next ? next.slice(API_BASE.length) : null;
  }
  return tracks;
}
