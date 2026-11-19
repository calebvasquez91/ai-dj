// Pure helpers for the admin Activity page: the filter in its address, readable sizes and usage, and short device ids.
import { isAuditEventType, parseDayParam, type AuditEventType } from "@/lib/telemetry";
import { genresOfTrack } from "@/lib/genreLibrary";
import type { GenreTag } from "@/types/music";

/** One genre line on the Activity page: songs whose main genre it is, and songs that carry it among their tags (what the cards count, before their own exclusions). */
export interface GenreCountRow {
  genre: string;
  main: number;
  tagged: number;
}

/**
 * Both genre counts from the stored classification rows (tags already parsed). `main` is each song counted once under its best genre (the `genre`
 * column). `tagged` counts a song under every genre it has, resolved by the same function the "Made by your DJ" cards use (genresOfTrack), and always
 * includes the song's main genre, so tagged is never below main even when the stored summary is out of step with the tags. Biggest `main` first,
 * ties by `tagged`, then A to Z.
 */
export function genreCountRows(rows: readonly { genre: string | null; tags: readonly GenreTag[] }[]): GenreCountRow[] {
  const byGenre = new Map<string, GenreCountRow>();
  const row = (genre: string) => {
    let r = byGenre.get(genre);
    if (!r) byGenre.set(genre, (r = { genre, main: 0, tagged: 0 }));
    return r;
  };
  for (const r of rows) {
    const genres = new Set(genresOfTrack({ genreTags: [...r.tags], genre: r.genre ?? undefined, subgenres: [] }).map((g) => g.genre));
    if (r.genre) {
      row(r.genre).main++;
      genres.add(r.genre);
    }
    for (const g of genres) row(g).tagged++;
  }
  return [...byGenre.values()].sort((a, b) => b.main - a.main || b.tagged - a.tagged || a.genre.localeCompare(b.genre));
}

export interface ActivityFilter {
  /** Start of the first day, or null for no lower bound. */
  from: Date | null;
  /** End of the last day, or null for no upper bound. */
  to: Date | null;
  /** One audit event type, or null for all of them. */
  type: AuditEventType | null;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The date range and event type in the page's address (?from=2026-11-01&to=2026-11-19&type=song_added). Anything not well formed is ignored; a range given backwards is put the right way round. */
export function parseActivityFilter(query: Record<string, string | string[] | undefined>): ActivityFilter {
  let from = parseDayParam(first(query.from));
  let to = parseDayParam(first(query.to), true);
  if (from && to && from > to) {
    const start = parseDayParam(first(query.to));
    const end = parseDayParam(first(query.from), true);
    from = start;
    to = end;
  }
  const type = first(query.type);
  return { from, to, type: isAuditEventType(type) ? type : null };
}

/** The filter as query-string pairs (empty values left out), for the export links. */
export function activityFilterParams(filter: { from?: string | null; to?: string | null; type?: string | null }): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  if (filter.type) params.set("type", filter.type);
  return params;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** "3.2 GB of 100 GB (3%)", or just the used size when no limit is set. */
export function usageLine(usedBytes: number, limitBytes: number | null): string {
  if (limitBytes == null || limitBytes <= 0) return `${formatBytes(usedBytes)} used`;
  const pct = Math.min(999, Math.round((usedBytes / limitBytes) * 100));
  return `${formatBytes(usedBytes)} of ${formatBytes(limitBytes)} (${pct}%)`;
}

/** A limit from a setting in gigabytes (or megabytes), as bytes; null when it is missing or not a positive number. */
export function limitBytes(raw: string | undefined, unitBytes: number): number | null {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? Math.round(n * unitBytes) : null;
}

/** The first eight characters of an anonymous device id, enough to tell devices apart on screen. */
export function shortDeviceId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "unknown";
}
