/**
 * Voice stretches from time-stamped ("synced") lyrics, as served by LRCLIB. Only the TIMES are used and kept: the
 * lines' words never leave this module (same rule as the lyric fingerprint, lib/lyrics.ts). The result feeds the
 * voice map (lib/voiceMap.ts) for tracks that have no isolated vocal stem yet.
 *
 * An LRC file is lines like `[01:23.45] some words`; an empty line (`[02:10.00]`) marks the end of the preceding
 * line's singing — the most useful timestamp there is for "when did the voices stop".
 */

import type { VoiceMap } from "@/lib/voiceMap";

/** A sung line rarely lasts longer than this; used when no later timestamp bounds it. */
const MAX_LINE_SEC = 7;
/** Lyrics from the service apply to this track only when their length is this close to the file's. */
export const LYRICS_DURATION_TOLERANCE = 0.03;

export interface SyncedLine {
  time: number;
  /** Whether the line has any words (empty lines are end-of-singing markers). */
  hasText: boolean;
}

const TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/** Parses LRC text into timestamped lines, in time order. Lines without a timestamp, and tags like [ar:...], are skipped. */
export function parseSyncedLyrics(lrc: string): SyncedLine[] {
  const lines: SyncedLine[] = [];
  for (const rawLine of lrc.split(/\r?\n/)) {
    const stamps = [...rawLine.matchAll(TIMESTAMP)];
    if (stamps.length === 0) continue;
    const text = rawLine.replace(TIMESTAMP, "").trim();
    for (const m of stamps) {
      const frac = m[3] ? Number(`0.${m[3]}`) : 0;
      const time = Number(m[1]) * 60 + Number(m[2]) + frac;
      if (Number.isFinite(time)) lines.push({ time, hasText: text.length > 0 });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** [start, end] of each sung line: from its timestamp to the next timestamp, capped at MAX_LINE_SEC. */
export function voiceSegmentsFromLines(lines: SyncedLine[]): [number, number][] {
  const segments: [number, number][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].hasText) continue;
    const start = lines[i].time;
    const next = lines[i + 1]?.time;
    const end = Math.min(next ?? start + MAX_LINE_SEC, start + MAX_LINE_SEC);
    if (end > start) segments.push([start, end]);
  }
  // join lines that run straight into each other
  const merged: [number, number][] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && seg[0] - last[1] <= 0.5) last[1] = Math.max(last[1], seg[1]);
    else merged.push([seg[0], seg[1]]);
  }
  return merged;
}

/** Whether lyrics for a recording of `lyricsDurationSec` can be laid over a file of `trackDurationSec` (an extended or live version won't line up). */
export function lyricsFitTrack(lyricsDurationSec: number | null | undefined, trackDurationSec: number): boolean {
  if (!lyricsDurationSec || !(trackDurationSec > 0)) return false;
  return Math.abs(lyricsDurationSec - trackDurationSec) <= trackDurationSec * LYRICS_DURATION_TOLERANCE;
}

/** A voice map from synced lyrics, or null when there are no usable timed lines. */
export function voiceMapFromSyncedLyrics(lrc: string, lyricsDurationSec: number): VoiceMap | null {
  const segments = voiceSegmentsFromLines(parseSyncedLyrics(lrc));
  if (segments.length === 0) return null;
  return { source: "lyrics", durationSec: lyricsDurationSec, segments };
}

const LRCLIB_SEARCH_URL = "https://lrclib.net/api/search";
const UNKNOWN_ARTIST = "Unknown Artist";

interface LrclibSyncedResult {
  syncedLyrics?: string | null;
  duration?: number | null;
  instrumental?: boolean;
}

/**
 * Looks up time-stamped lyrics for a track and reduces them to a voice map. Resolves null for a genuine "searched,
 * nothing usable" (no synced lyrics, an instrumental, or only recordings of a different length); throws on a
 * network/parse failure so callers can tell the two apart.
 */
export async function getSyncedVoiceMap(title: string, artist: string, trackDurationSec: number): Promise<VoiceMap | null> {
  const params = new URLSearchParams({ track_name: title });
  if (artist && artist !== UNKNOWN_ARTIST) params.set("artist_name", artist);
  const res = await fetch(`${LRCLIB_SEARCH_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`LRCLIB search failed: ${res.status}`);
  const results = (await res.json()) as LrclibSyncedResult[];
  for (const r of results) {
    if (r.instrumental || !r.syncedLyrics || !lyricsFitTrack(r.duration, trackDurationSec)) continue;
    const map = voiceMapFromSyncedLyrics(r.syncedLyrics, r.duration as number);
    if (map) return map;
  }
  return null;
}
