/**
 * What GET /api/catalog/search does, as pure functions so it can be tested: reading and validating the query string,
 * shaping a page of tracks for the client (each with its credit line), looking up the source adapter, and a short
 * cache of identical searches so a free catalog's request cap (Jamendo: 35,000 a month) isn't spent on repeats.
 */
import { BoundedCache } from "@/lib/boundedCache";
import { attributionFor, type Attribution } from "@/lib/catalog/attribution";
import { createJamendoAdapter, JAMENDO_SOURCE } from "@/lib/catalog/jamendo";
import type { CatalogAdapter, CatalogPage, CatalogQuery, CatalogTrack } from "@/lib/catalog/types";
import { cleanText } from "@/lib/apiValidation";

/** The catalog sources the route can search. */
export const CATALOG_SOURCES: readonly string[] = [JAMENDO_SOURCE];
const SPEEDS: readonly string[] = ["verylow", "low", "medium", "high", "veryhigh"];

export const CATALOG_MAX_TEXT = 100;
export const CATALOG_MAX_TAGS = 5;
const MAX_TAG_CHARS = 32;
export const CATALOG_DEFAULT_LIMIT = 20;
export const CATALOG_MAX_LIMIT = 50;
export const CATALOG_MAX_OFFSET = 10_000;
const MAX_DURATION_PARAM_SEC = 3600;
/**
 * A real tag: starts with a letter or digit (any language) and goes on with letters, digits, spaces and the few marks tags
 * really use (r&b, drum'n'bass, lo-fi, d.j.). No control characters, angle brackets, slashes or other punctuation; the
 * value is URL-encoded on its way to the source, so this is about sense, not about escaping.
 */
const TAG_SHAPE = /^[\p{L}\p{N}][\p{L}\p{N} &'+.-]*$/u;

export interface ParsedCatalogRequest {
  source: string;
  query: CatalogQuery;
}

export type ParseResult = { ok: true; value: ParsedCatalogRequest } | { ok: false; error: string };

/** A non-negative whole number from a query parameter, or null when it is absent or malformed. */
function intParam(params: URLSearchParams, name: string, max: number): number | null | "bad" {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) return "bad";
  const n = Number(raw.trim());
  return n > max ? "bad" : n;
}

function listParam(params: URLSearchParams, name: string): string[] {
  const raw = params.get(name);
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Everything a client can put in the query string is untrusted: this bounds sizes and shapes and rejects what isn't
 * understood (an unknown source, a speed bucket that doesn't exist, a number that isn't one) rather than passing it on.
 */
export function parseCatalogQuery(params: URLSearchParams): ParseResult {
  const source = (params.get("source") ?? JAMENDO_SOURCE).trim().toLowerCase();
  if (!CATALOG_SOURCES.includes(source)) return { ok: false, error: `Unknown source "${cleanText(source, 30)}".` };

  const text = cleanText(params.get("q"), CATALOG_MAX_TEXT);

  const tags = listParam(params, "tags");
  if (tags.length > CATALOG_MAX_TAGS) return { ok: false, error: `At most ${CATALOG_MAX_TAGS} tags.` };
  if (tags.some((t) => t.length > MAX_TAG_CHARS || !TAG_SHAPE.test(t))) {
    return { ok: false, error: "A tag has characters that aren't allowed." };
  }

  const speed = listParam(params, "speed");
  if (speed.some((s) => !SPEEDS.includes(s))) return { ok: false, error: `speed must be any of ${SPEEDS.join(", ")}.` };

  const vocalRaw = params.get("vocal")?.trim().toLowerCase();
  if (vocalRaw && vocalRaw !== "vocal" && vocalRaw !== "instrumental") return { ok: false, error: "vocal must be vocal or instrumental." };

  const min = intParam(params, "minDuration", MAX_DURATION_PARAM_SEC);
  const max = intParam(params, "maxDuration", MAX_DURATION_PARAM_SEC);
  const limit = intParam(params, "limit", CATALOG_MAX_LIMIT);
  const offset = intParam(params, "offset", CATALOG_MAX_OFFSET);
  if (min === "bad" || max === "bad") return { ok: false, error: `minDuration and maxDuration are whole seconds up to ${MAX_DURATION_PARAM_SEC}.` };
  if (min !== null && max !== null && max <= min) return { ok: false, error: "maxDuration must be longer than minDuration." };
  if (limit === "bad" || limit === 0) return { ok: false, error: `limit is a whole number from 1 to ${CATALOG_MAX_LIMIT}.` };
  if (offset === "bad") return { ok: false, error: `offset is a whole number up to ${CATALOG_MAX_OFFSET}.` };

  const query: CatalogQuery = { limit: limit ?? CATALOG_DEFAULT_LIMIT, offset: offset ?? 0 };
  if (text) query.text = text;
  if (tags.length) query.tags = tags;
  if (speed.length) query.speed = speed;
  if (vocalRaw) query.vocal = vocalRaw as "vocal" | "instrumental";
  if (min !== null) query.minDurationSec = min;
  if (max !== null) query.maxDurationSec = max;
  return { ok: true, value: { source, query } };
}

/** What the client gets for one track: everything it needs to show, credit and (once the user adds it) play it. */
export interface CatalogTrackDto {
  id: string;
  source: string;
  title: string;
  artist: string;
  album?: string;
  durationSec: number;
  /** The source's own stream URL, passed straight on. Whether the source's audio host sends CORS headers (Web Audio's decodeAudioData needs them) is still to be checked with a real client id (scripts/check-jamendo.mts); if it doesn't, this becomes a same-origin proxy route and the contract changes here. */
  streamUrl: string;
  downloadUrl?: string;
  imageUrl?: string;
  pageUrl?: string;
  license: { code: string; label: string; url: string; requiresAttribution: boolean };
  tags: string[];
  speed?: string;
  vocal?: "vocal" | "instrumental";
  attribution: Attribution;
}

export interface CatalogSearchResponse {
  tracks: CatalogTrackDto[];
  offset: number;
  nextOffset: number | null;
  /** What the source sent that was left out (unplayable data, or a license the app can't use). */
  skipped: { invalid: number; license: number };
}

export function toTrackDto(track: CatalogTrack): CatalogTrackDto {
  return {
    id: track.id,
    source: track.source,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationSec: track.durationSec,
    streamUrl: track.streamUrl,
    downloadUrl: track.downloadUrl,
    imageUrl: track.imageUrl,
    pageUrl: track.pageUrl,
    license: {
      code: track.license.code,
      label: track.license.label,
      url: track.license.url,
      requiresAttribution: track.license.requiresAttribution,
    },
    tags: track.tags,
    speed: track.speed,
    vocal: track.vocal,
    attribution: attributionFor(track),
  };
}

export function serializeCatalogPage(page: CatalogPage): CatalogSearchResponse {
  // A next page the route would refuse to serve (offsets stop at CATALOG_MAX_OFFSET) is no next page: the client sees "no more".
  const nextOffset = page.nextOffset !== null && page.nextOffset > CATALOG_MAX_OFFSET ? null : page.nextOffset;
  return { tracks: page.tracks.map(toTrackDto), offset: page.offset, nextOffset, skipped: page.skipped };
}

/** The adapter for a source, or null when this server has no credentials for it (the route answers 503). */
export function getCatalogAdapter(source: string, env: Record<string, string | undefined> = process.env): CatalogAdapter | null {
  if (source === JAMENDO_SOURCE) {
    const clientId = env.JAMENDO_CLIENT_ID?.trim();
    return clientId ? createJamendoAdapter({ clientId }) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// A short cache of identical searches
// ---------------------------------------------------------------------------

/** How long a search result is reused. Catalog results change slowly; this keeps repeats (paging back, two listeners with the same query) off the free tier's request cap. */
export const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
export const CATALOG_CACHE_MAX_ENTRIES = 200;

export interface CachedSearch {
  search(adapter: CatalogAdapter, query: CatalogQuery, nowMs?: number): Promise<CatalogPage>;
}

/** Wraps an adapter's search with a per-process cache. Failures are never cached, and a concurrent identical search shares the one in flight. */
export function createCachedSearch({
  ttlMs = CATALOG_CACHE_TTL_MS,
  maxEntries = CATALOG_CACHE_MAX_ENTRIES,
}: { ttlMs?: number; maxEntries?: number } = {}): CachedSearch {
  const done = new BoundedCache<{ at: number; page: CatalogPage }>(maxEntries);
  const inFlight = new Map<string, Promise<CatalogPage>>();
  return {
    async search(adapter, query, nowMs = Date.now()) {
      const key = `${adapter.id}|${JSON.stringify(query)}`;
      const hit = done.get(key);
      if (hit && nowMs - hit.at < ttlMs) return hit.page;
      const pending = inFlight.get(key);
      if (pending) return pending;
      const request = adapter.search(query).then(
        (page) => {
          done.set(key, { at: nowMs, page });
          inFlight.delete(key);
          return page;
        },
        (err) => {
          inFlight.delete(key);
          throw err;
        }
      );
      inFlight.set(key, request);
      return request;
    },
  };
}
