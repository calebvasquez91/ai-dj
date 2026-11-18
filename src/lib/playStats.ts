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

/** What an account's first report may carry (there is no earlier report to measure the time against). */
export const FIRST_REPORT_SECONDS = 90;
/** Nobody can listen more than a day in a day: the most one account can have credited in any 24 hours. */
export const DAILY_CAP_SECONDS = 24 * 60 * 60;
/** A report may carry a little more than the clock time since the previous one (two devices playing at once, timer jitter). */
const BUDGET_RATE = 1.5;
const BUDGET_SLACK_SECONDS = 5;

/**
 * The most seconds one report may be credited with, from how long ago the account last reported and what it already has credited in
 * the last 24 hours. The player's reports are about 1:1 with the clock, so an honest one always fits; a client that claims hours in a
 * request, or sends requests faster than real time, does not.
 */
export function reportBudgetSeconds(sinceLastReportMs: number | null, creditedLast24hSeconds: number): number {
  const byClock = sinceLastReportMs == null ? FIRST_REPORT_SECONDS : (Math.max(0, sinceLastReportMs) / 1000) * BUDGET_RATE + BUDGET_SLACK_SECONDS;
  return Math.max(0, Math.min(byClock, DAILY_CAP_SECONDS - Math.max(0, creditedLast24hSeconds)));
}

/** Scales the segments down, all by the same factor, so they add up to no more than `budgetSeconds`; unchanged when they already fit. */
export function fitToBudget(segments: readonly PlaySegment[], budgetSeconds: number): PlaySegment[] {
  const total = segments.reduce((sum, s) => sum + s.seconds, 0);
  if (total <= budgetSeconds) return segments.map((s) => ({ ...s }));
  if (budgetSeconds <= 0 || total <= 0) return [];
  const factor = budgetSeconds / total;
  return segments.map((s) => ({ ...s, seconds: Math.round(s.seconds * factor * 10) / 10 })).filter((s) => s.seconds >= 0.5);
}

export const NOT_CLASSIFIED = "Not classified";

/**
 * Hours per genre from listening totals per song: a song's genre is its CURRENT genre (so a song classified, or corrected by the
 * admin, after it was played counts under the right genre), falling back to the genre recorded when it was played (for a song that
 * has since been deleted), and finally "Not classified". Biggest first.
 */
export function foldGenres(
  rows: readonly { trackId: string | null; genre: string | null; seconds: number }[],
  currentGenre: ReadonlyMap<string, string | null>,
): { label: string; seconds: number }[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const current = r.trackId ? currentGenre.get(r.trackId) : null;
    const label = current ?? r.genre ?? NOT_CLASSIFIED;
    totals.set(label, (totals.get(label) ?? 0) + r.seconds);
  }
  return [...totals.entries()].map(([label, seconds]) => ({ label, seconds })).sort((a, b) => b.seconds - a.seconds);
}
