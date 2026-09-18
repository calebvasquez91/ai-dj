// Thin client for the parts of the YouTube Data API v3 this app needs —
// called directly from the browser with the user's own OAuth access token
// (Google's Data API supports CORS for this). Deliberately never uses
// search.list (100 quota units/call) — playlists.list, playlistItems.list,
// and videos.list are each 1 unit, so importing even a large library stays
// cheap against the default 10,000 units/day.
import { getValidAccessToken } from "@/lib/googleAuth";

const API_BASE = "https://www.googleapis.com/youtube/v3";

export interface YouTubePlaylistSummary {
  id: string;
  title: string;
  thumbnailUrl?: string;
  itemCount: number;
}

export interface YouTubePlaylistItem {
  videoId: string;
  title: string;
  artist: string;
  thumbnailUrl?: string;
}

async function youtubeFetch(path: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    // Token expired mid-session — one silent-refresh retry before giving up.
    const refreshed = await getValidAccessToken();
    if (!refreshed) throw new Error("YouTube session expired — reconnect your account.");
    const retry = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${refreshed}` } });
    if (!retry.ok) throw new Error(`YouTube Data API error (${retry.status}).`);
    return retry.json();
  }
  if (!res.ok) throw new Error(`YouTube Data API error (${res.status}).`);
  return res.json();
}

/** ISO-8601 duration ("PT4M13S") -> seconds. Data API's videos.list is the only endpoint that returns this — playlistItems.list doesn't include it. */
export function parseIsoDuration(iso: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
}

/** YouTube Music's auto-generated artist channels commonly render as "Artist - Topic" — strip that suffix as a best-effort artist name, same spirit as localAudio.ts's filename parsing. */
function channelTitleToArtist(channelTitle: string): string {
  return channelTitle.replace(/\s*-\s*Topic$/, "").trim() || channelTitle;
}

export async function listMyPlaylists(): Promise<YouTubePlaylistSummary[]> {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to YouTube.");

  const playlists: YouTubePlaylistSummary[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ part: "snippet,contentDetails", mine: "true", maxResults: "50" });
    if (pageToken) query.set("pageToken", pageToken);
    const data = await youtubeFetch(`/playlists?${query}`, token);
    const items = (data.items as Array<Record<string, unknown>>) ?? [];
    for (const item of items) {
      const snippet = item.snippet as Record<string, unknown>;
      const thumbnails = snippet?.thumbnails as Record<string, { url?: string }> | undefined;
      playlists.push({
        id: item.id as string,
        title: (snippet?.title as string) ?? "Untitled playlist",
        thumbnailUrl: thumbnails?.medium?.url ?? thumbnails?.default?.url,
        itemCount: ((item.contentDetails as Record<string, unknown>)?.itemCount as number) ?? 0,
      });
    }
    pageToken = data.nextPageToken as string | undefined;
  } while (pageToken);
  return playlists;
}

const UNAVAILABLE_TITLES = new Set(["Deleted video", "Private video"]);

async function listPlaylistItemsRaw(playlistId: string, token: string): Promise<YouTubePlaylistItem[]> {
  const items: YouTubePlaylistItem[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ part: "snippet", playlistId, maxResults: "50" });
    if (pageToken) query.set("pageToken", pageToken);
    const data = await youtubeFetch(`/playlistItems?${query}`, token);
    const rawItems = (data.items as Array<Record<string, unknown>>) ?? [];
    for (const item of rawItems) {
      const snippet = item.snippet as Record<string, unknown>;
      const title = snippet?.title as string | undefined;
      const videoId = (snippet?.resourceId as Record<string, unknown>)?.videoId as string | undefined;
      if (!title || !videoId || UNAVAILABLE_TITLES.has(title)) continue;
      const thumbnails = snippet?.thumbnails as Record<string, { url?: string }> | undefined;
      items.push({
        videoId,
        title,
        artist: channelTitleToArtist((snippet?.videoOwnerChannelTitle as string) ?? "Unknown Artist"),
        thumbnailUrl: thumbnails?.medium?.url ?? thumbnails?.default?.url,
      });
    }
    pageToken = data.nextPageToken as string | undefined;
  } while (pageToken);
  return items;
}

interface VideoDetails {
  durationSec: number;
  embeddable: boolean;
}

/**
 * Duration isn't on playlistItems — batched (50 ids/call, the API's max)
 * videos.list lookups fill it in. Also pulls `status.embeddable`, the one
 * reliable signal for whether a video can actually play in an iframe:
 * playlistItems only flags a video as "Deleted video"/"Private video" when
 * it's gone from the OWNER's own playlist metadata — a video that's still
 * fully public on YouTube but has embedding disabled by the rights holder
 * (common for official-audio/label uploads) sails right through that check
 * with its real title intact, and only videos.list's `status` exposes the
 * actual embed restriction. Same request, same 1 quota unit — just a wider
 * `part` list, no extra cost.
 */
async function getVideoDetails(videoIds: string[], token: string): Promise<Record<string, VideoDetails>> {
  const details: Record<string, VideoDetails> = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const query = new URLSearchParams({ part: "contentDetails,status", id: batch.join(",") });
    const data = await youtubeFetch(`/videos?${query}`, token);
    const items = (data.items as Array<Record<string, unknown>>) ?? [];
    for (const item of items) {
      const iso = (item.contentDetails as Record<string, unknown>)?.duration as string | undefined;
      const status = item.status as Record<string, unknown> | undefined;
      details[item.id as string] = {
        durationSec: iso ? parseIsoDuration(iso) : 0,
        // Absent only on very old/malformed responses — treat as playable
        // rather than dropping a track over a missing field.
        embeddable: status?.embeddable !== false,
      };
    }
  }
  return details;
}

export interface YouTubeImportedTrack extends YouTubePlaylistItem {
  durationSec: number;
}

/**
 * Full per-playlist fetch: items + their real durations, with anything
 * unplayable filtered out — deleted/private videos (caught earlier from
 * playlistItems' own placeholder titles) and, just as important, videos
 * that are still fully public but not embeddable, which is invisible until
 * this videos.list lookup. A video absent from this response entirely
 * (removed between the two calls) is dropped the same way.
 */
export async function listPlaylistItemsWithDuration(playlistId: string): Promise<YouTubeImportedTrack[]> {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to YouTube.");
  const items = await listPlaylistItemsRaw(playlistId, token);
  if (items.length === 0) return [];
  const details = await getVideoDetails(
    items.map((i) => i.videoId),
    token
  );
  return items
    .filter((item) => details[item.videoId]?.embeddable)
    .map((item) => ({ ...item, durationSec: details[item.videoId].durationSec }));
}
