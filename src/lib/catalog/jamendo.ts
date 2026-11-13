// Server-only. The search is called from our own backend, so the browser never calls Jamendo's API (and never sees a key
// in a request URL it makes). Be clear about what that does and doesn't give: a Jamendo client id is a public app
// identifier, not a password (Jamendo expects it in client-side apps), and the stream URLs Jamendo returns may carry it in
// their own query string (a `from=app-<id>` style parameter), which this module passes through unchanged because the
// stream may need it. Only an explicit `client_id=` parameter is removed from the URLs it hands on. Written against
// Jamendo's published v3.0 /tracks docs; not yet run against the live API (no client id was available when this was
// written): scripts/check-jamendo.mts runs the first real search and reports the response shape, whether the stream
// URLs carry the id, whether they send CORS headers for Web Audio, and what the ccnc/ccnd/ccsa filters do. Until then the
// license rules are enforced here on every track from its own `license_ccurl`, never trusting a server-side filter.

import { licenseRejection, parseLicenseUrl, DEFAULT_LICENSE_POLICY, type LicensePolicy, type LicenseRejection } from "@/lib/catalog/license";
import { CatalogSourceError, type CatalogAdapter, type CatalogQuery, type CatalogTrack } from "@/lib/catalog/types";

export const JAMENDO_SOURCE = "jamendo";
const JAMENDO_API_BASE = "https://api.jamendo.com/v3.0";
const JAMENDO_TIMEOUT_MS = 8000;
export const JAMENDO_DEFAULT_LIMIT = 20;
export const JAMENDO_MAX_LIMIT = 200;
/** Jamendo's mp32 is variable-bitrate MP3, better than the 96 kbps default for tracks that get stretched and mixed. */
const AUDIO_FORMAT = "mp32";
const IMAGE_SIZE = "300";

/**
 * Most of Jamendo's catalog is under licenses the app can't use (NonCommercial above all), so a page is fetched larger
 * than asked for and filtered, and fetched again (a few times at most) until it holds the number asked for.
 */
export const JAMENDO_FETCH_MULTIPLIER = 3;
export const JAMENDO_MAX_FETCHES = 3;

/** Hosts Jamendo's own links and media are served from. A URL anywhere else is not passed on. */
const JAMENDO_HOSTS = ["jamendo.com", "imgjam.com"];

/** True for jamendo.com / imgjam.com and their subdomains, and nothing that merely contains the name (jamendo.com.evil.example, evil-jamendo.com). */
export function isJamendoHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return JAMENDO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** The search request for a query. A multi-value filter is joined with spaces, which URLSearchParams writes as the "+" Jamendo reads as its list separator. */
export function buildJamendoSearchUrl(query: CatalogQuery, clientId: string): string {
  const limit = Math.min(JAMENDO_MAX_LIMIT, Math.max(1, Math.floor(query.limit ?? JAMENDO_DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const params = new URLSearchParams({
    client_id: clientId,
    format: "json",
    limit: String(limit),
    offset: String(offset),
    include: "musicinfo",
    audioformat: AUDIO_FORMAT,
    imagesize: IMAGE_SIZE,
    // Singles as well as album tracks (Jamendo returns album tracks only by default).
    type: "single albumtrack",
  });
  const text = query.text?.trim();
  if (text) params.set("search", text);
  if (query.tags?.length) params.set("tags", query.tags.join(" "));
  if (query.speed?.length) params.set("speed", query.speed.join(" "));
  if (query.vocal) params.set("vocalinstrumental", query.vocal);
  if (query.minDurationSec !== undefined || query.maxDurationSec !== undefined) {
    const min = Math.max(0, Math.floor(query.minDurationSec ?? 0));
    const max = Math.floor(query.maxDurationSec ?? 3600);
    if (max > min) params.set("durationbetween", `${min}_${max}`);
  }
  return `${JAMENDO_API_BASE}/tracks/?${params.toString()}`;
}

interface JamendoRawTrack {
  id?: string | number;
  name?: string;
  duration?: number | string;
  artist_name?: string;
  album_name?: string;
  image?: string;
  album_image?: string;
  license_ccurl?: string;
  audio?: string;
  audiodownload?: string;
  audiodownload_allowed?: boolean;
  shareurl?: string;
  musicinfo?: {
    vocalinstrumental?: string;
    speed?: string;
    tags?: { genres?: string[]; instruments?: string[]; vartags?: string[] };
  };
}

interface JamendoResponse {
  headers?: { status?: string; code?: number; error_message?: string; results_count?: number };
  results?: JamendoRawTrack[];
}

export type JamendoParse = { track: CatalogTrack } | { skipped: "invalid" | LicenseRejection };

/** An https URL on one of Jamendo's own hosts, with any explicit `client_id` parameter removed; undefined for anything else. */
function jamendoUrl(value: unknown, clientIdParamToStrip = true): string | undefined {
  if (typeof value !== "string") return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || !isJamendoHost(url.hostname)) return undefined;
  if (clientIdParamToStrip && url.searchParams.has("client_id")) url.searchParams.delete("client_id");
  return url.toString();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()) : [];
}

/** One raw Jamendo track to a `CatalogTrack`, or the reason it was left out: unplayable data, or a license the app can't use. */
export function parseJamendoTrack(raw: JamendoRawTrack, policy: LicensePolicy = DEFAULT_LICENSE_POLICY): JamendoParse {
  const sourceId = raw.id !== undefined && raw.id !== null ? String(raw.id).trim() : "";
  const title = typeof raw.name === "string" ? raw.name.trim() : "";
  const streamUrl = jamendoUrl(raw.audio);
  const durationSec = Number(raw.duration);
  if (!sourceId || !title || !streamUrl || !Number.isFinite(durationSec) || durationSec <= 0) return { skipped: "invalid" };

  const license = parseLicenseUrl(raw.license_ccurl);
  const rejection = licenseRejection(license, policy);
  if (rejection || !license) return { skipped: rejection ?? "unknown" };

  const info = raw.musicinfo;
  const tags = [...stringList(info?.tags?.genres), ...stringList(info?.tags?.instruments), ...stringList(info?.tags?.vartags)];
  const vocal = info?.vocalinstrumental === "vocal" || info?.vocalinstrumental === "instrumental" ? info.vocalinstrumental : undefined;
  const downloadUrl = raw.audiodownload_allowed === true ? jamendoUrl(raw.audiodownload) : undefined;

  return {
    track: {
      id: `${JAMENDO_SOURCE}:${sourceId}`,
      source: JAMENDO_SOURCE,
      sourceId,
      title,
      artist: typeof raw.artist_name === "string" && raw.artist_name.trim() ? raw.artist_name.trim() : "Unknown Artist",
      album: typeof raw.album_name === "string" && raw.album_name.trim() ? raw.album_name.trim() : undefined,
      durationSec,
      streamUrl,
      downloadUrl,
      imageUrl: jamendoUrl(raw.image) ?? jamendoUrl(raw.album_image),
      pageUrl: jamendoUrl(raw.shareurl),
      license,
      tags,
      speed: typeof info?.speed === "string" && info.speed ? info.speed : undefined,
      vocal,
    },
  };
}

/**
 * A whole /tracks response as one outcome per result, in Jamendo's order: a usable track or the reason it was left out.
 * Throws `CatalogSourceError` when Jamendo reports a failure (it does so with HTTP 200, e.g. for a bad client id).
 */
export function parseJamendoResults(body: unknown, policy: LicensePolicy = DEFAULT_LICENSE_POLICY): JamendoParse[] {
  const response = (body && typeof body === "object" ? body : {}) as JamendoResponse;
  if (response.headers?.status && response.headers.status !== "success") {
    throw new CatalogSourceError(`Jamendo refused the request: ${response.headers.error_message || `code ${response.headers.code ?? "unknown"}`}`);
  }
  if (!Array.isArray(response.results)) throw new CatalogSourceError("Jamendo sent a response in an unexpected shape");
  return response.results.map((raw) => parseJamendoTrack(raw ?? {}, policy));
}

export interface JamendoAdapterOptions {
  clientId: string;
  policy?: LicensePolicy;
  /** For tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createJamendoAdapter(options: JamendoAdapterOptions): CatalogAdapter {
  const clientId = options.clientId.trim();
  if (!clientId) throw new CatalogSourceError("Jamendo needs a client id");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? JAMENDO_TIMEOUT_MS;
  const policy = options.policy ?? DEFAULT_LICENSE_POLICY;

  async function fetchBody(query: CatalogQuery): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(buildJamendoSearchUrl(query, clientId), { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      // The underlying error can carry the request URL, and with it the client id: report only that it failed.
      throw new CatalogSourceError("Jamendo could not be reached or took too long");
    }
    if (!response.ok) throw new CatalogSourceError(`Jamendo answered with HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new CatalogSourceError("Jamendo sent a response that is not JSON");
    }
  }

  return {
    id: JAMENDO_SOURCE,
    async search(query) {
      const wanted = Math.min(JAMENDO_MAX_LIMIT, Math.max(1, Math.floor(query.limit ?? JAMENDO_DEFAULT_LIMIT)));
      const fetchSize = Math.min(JAMENDO_MAX_LIMIT, wanted * JAMENDO_FETCH_MULTIPLIER);
      const start = Math.max(0, Math.floor(query.offset ?? 0));
      let position = start; // Jamendo's own offset: how far into its results this search has read
      const tracks: CatalogTrack[] = [];
      const seen = new Set<string>();
      const skipped = { invalid: 0, license: 0 };
      let exhausted = false;

      for (let fetches = 0; fetches < JAMENDO_MAX_FETCHES && tracks.length < wanted && !exhausted; fetches++) {
        const outcomes = parseJamendoResults(await fetchBody({ ...query, limit: fetchSize, offset: position }), policy);
        let consumed = 0;
        for (const outcome of outcomes) {
          if (tracks.length >= wanted) break;
          consumed += 1;
          if ("skipped" in outcome) {
            if (outcome.skipped === "invalid") skipped.invalid += 1;
            else skipped.license += 1;
          } else if (!seen.has(outcome.track.id)) {
            seen.add(outcome.track.id);
            tracks.push(outcome.track);
          }
        }
        position += consumed;
        // A short page that was read to its end is the end of the results; a full one may have more behind it.
        if (outcomes.length < fetchSize && consumed === outcomes.length) exhausted = true;
      }
      return { tracks, offset: start, nextOffset: exhausted ? null : position, skipped };
    },
  };
}
