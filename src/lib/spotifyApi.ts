// Thin client for the Spotify Web API endpoints this app needs, called
// directly from the browser with the user's own OAuth access token. Unlike
// YouTube's Data API, Spotify's playlist-items endpoint already includes
// duration, artist names, and album art in one call — no second batched
// lookup needed.
//
// Uses /playlists/{id}/items, not the older /playlists/{id}/tracks —
// Spotify deprecated the latter in a March 2026 migration; Development Mode
// apps get a 403 from it now regardless of scope. The field names changed
// to match: each playlist's own track-count field is `items` (was
// `tracks`), and each entry in the items list carries the track under
// `item` (was `track`).
//
// Development Mode is also permanently restricted to playlists the
// connected account owns or collaborates on — confirmed by testing, not
// just documentation: a followed/Spotify-curated playlist 403s even though
// its metadata (title, track count) is visible via /me/playlists. There's
// no way around this short of Spotify's Extended Quota approval (which
// requires a registered business), so listMyPlaylists() flags each
// playlist's accessibility up front via its own `owner`/`collaborative`
// fields, rather than letting the user discover it via a failed import.
import { getValidSpotifyToken } from "@/lib/spotifyAuth";

const API_BASE = "https://api.spotify.com/v1";

export interface SpotifyPlaylistSummary {
  id: string;
  title: string;
  thumbnailUrl?: string;
  itemCount: number;
  /** false for a playlist the account only follows (not owned, not collaborative) — Development Mode 403s on its items regardless of scope, so the UI should disable rather than offer it. */
  accessible: boolean;
}

export interface SpotifyImportedTrack {
  spotifyTrackId: string;
  title: string;
  artist: string;
  durationSec: number;
  thumbnailUrl?: string;
}

async function errorMessage(res: Response): Promise<string> {
  const reason = await res
    .json()
    .then((body) => body?.error?.message as string | undefined)
    .catch(() => undefined);
  return reason ? `Spotify Web API error (${res.status}): ${reason}` : `Spotify Web API error (${res.status}).`;
}

async function spotifyFetch(path: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    const refreshed = await getValidSpotifyToken();
    if (!refreshed) throw new Error("Spotify session expired — reconnect your account.");
    const retry = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${refreshed}` } });
    if (!retry.ok) throw new Error(await errorMessage(retry));
    return retry.json();
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export async function listMyPlaylists(): Promise<SpotifyPlaylistSummary[]> {
  const token = await getValidSpotifyToken();
  if (!token) throw new Error("Not connected to Spotify.");

  const me = await spotifyFetch("/me", token);
  const myUserId = me.id as string;

  const playlists: SpotifyPlaylistSummary[] = [];
  let path: string | null = "/me/playlists?limit=50";
  while (path) {
    const data = await spotifyFetch(path, token);
    const items = (data.items as Array<Record<string, unknown>>) ?? [];
    for (const item of items) {
      const images = item.images as Array<{ url?: string }> | null;
      const playlistItems = item.items as Record<string, unknown> | undefined;
      const owner = item.owner as Record<string, unknown> | undefined;
      const accessible = item.collaborative === true || owner?.id === myUserId;
      playlists.push({
        id: item.id as string,
        title: (item.name as string) ?? "Untitled playlist",
        thumbnailUrl: images?.[0]?.url,
        itemCount: (playlistItems?.total as number) ?? 0,
        accessible,
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
  let path: string | null = `/playlists/${playlistId}/items?limit=100`;
  while (path) {
    const data = await spotifyFetch(path, token);
    const items = (data.items as Array<Record<string, unknown>>) ?? [];
    for (const item of items) {
      const track = item.item as Record<string, unknown> | null;
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
