// Server-only. Deezer's public catalog API returns a `bpm` field on tracks
// with no authentication required, but it doesn't send CORS headers for
// cross-origin browser requests (confirmed directly — a fetch from a real
// page on a different origin fails, while the same request from a Node
// server-side context works fine) — unlike this app's other external API
// calls (YouTube's Data API), this one can only be made from our own
// backend, never straight from the client.
//
// This is a metadata match by title/artist, not analysis of the actual
// video's audio — a cover, remix, or live version can legitimately have a
// different real tempo than whatever Deezer returns for the "canonical"
// track. Callers are expected to treat the result as lower-confidence than
// real per-sample analysis (see mix-engine.ts's MIN_TEMPO_CONFIDENCE_FOR_TRUST
// gating) and to degrade gracefully to no-bpm on any null/failure — never a
// broken state.
const DEEZER_API_BASE = "https://api.deezer.com";

interface DeezerSearchResponse {
  data?: { id?: number }[];
}

interface DeezerTrackResponse {
  bpm?: number;
}

/** Best-effort BPM lookup by title/artist. Returns null on no match, a missing/zero bpm, or any network failure — never throws. */
export async function lookupBpmFromDeezer(title: string, artist: string): Promise<number | null> {
  try {
    const query = encodeURIComponent(`${artist} ${title}`.trim());
    const searchRes = await fetch(`${DEEZER_API_BASE}/search?q=${query}&limit=1`);
    if (!searchRes.ok) return null;
    const searchData = (await searchRes.json()) as DeezerSearchResponse;
    const trackId = searchData.data?.[0]?.id;
    if (!trackId) return null;

    const trackRes = await fetch(`${DEEZER_API_BASE}/track/${trackId}`);
    if (!trackRes.ok) return null;
    const trackData = (await trackRes.json()) as DeezerTrackResponse;
    return typeof trackData.bpm === "number" && trackData.bpm > 0 ? trackData.bpm : null;
  } catch {
    return null;
  }
}
