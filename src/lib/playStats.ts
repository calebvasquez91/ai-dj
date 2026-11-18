// Pure helpers for the listening statistics: how a report from the player is checked, and how seconds are shown and ranked.
// The database side is in lib/playStatsServer.ts.

/** The most seconds one reported segment may carry: the player reports about every 30 s, so anything near this is already a stretch. */
export const MAX_SEGMENT_SECONDS = 300;
/** The most segments one request may carry. */
export const MAX_SEGMENTS_PER_REQUEST = 20;

export interface PlaySegment {
  trackId: string;
  playlistId: string | null;
  seconds: number;
}

/**
 * Reads what the player sent. Anything that is not a well-formed segment is dropped (never an error: a stray bad entry must not
 * lose the good ones), seconds are bounded, and segments of the same song and playlist are merged. Returns at most
 * MAX_SEGMENTS_PER_REQUEST segments.
 */
export function parsePlaySegments(body: unknown): PlaySegment[] {
  const raw = (body as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(raw)) return [];
  const merged = new Map<string, PlaySegment>();
  for (const item of raw.slice(0, MAX_SEGMENTS_PER_REQUEST * 2)) {
    if (!item || typeof item !== "object") continue;
    const { trackId, playlistId, seconds } = item as { trackId?: unknown; playlistId?: unknown; seconds?: unknown };
    if (typeof trackId !== "string" || trackId.length === 0 || trackId.length > 64) continue;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) continue;
    const playlist = typeof playlistId === "string" && playlistId.length > 0 && playlistId.length <= 64 ? playlistId : null;
    const key = `${trackId}|${playlist ?? ""}`;
    const bounded = Math.min(seconds, MAX_SEGMENT_SECONDS);
    const existing = merged.get(key);
    if (existing) existing.seconds = Math.min(existing.seconds + bounded, MAX_SEGMENT_SECONDS);
    else merged.set(key, { trackId, playlistId: playlist, seconds: bounded });
  }
  return [...merged.values()].slice(0, MAX_SEGMENTS_PER_REQUEST);
}

/** "12 h 30 min", "45 min", "40 s", or "0 min" for nothing: hours first because that is what the page is about. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return s === 0 ? "0 min" : `${s} s`;
  const totalMinutes = Math.round(s / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The start of a "last N days" window, or null for all time. */
export function rangeStart(days: number | null, now: number = Date.now()): Date | null {
  return days == null ? null : new Date(now - days * 24 * 60 * 60 * 1000);
}

/** The period the address asked for: 7 or 30 days, otherwise all time. */
export function parseDays(raw: string | string[] | undefined): 7 | 30 | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "7" ? 7 : v === "30" ? 30 : null;
}

export interface Ranked {
  key: string;
  label: string;
  seconds: number;
}

/** The biggest `limit` entries by seconds (ties keep their order), each with its share of the total. */
export function rankBySeconds<T extends { seconds: number }>(rows: readonly T[], limit: number): (T & { share: number })[] {
  const total = rows.reduce((sum, r) => sum + r.seconds, 0);
  return [...rows]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, limit)
    .map((r) => ({ ...r, share: total > 0 ? r.seconds / total : 0 }));
}
