// Small, pure input validators shared by the Route Handlers. Everything a
// client can send is untrusted — these bound sizes and shapes so a crafted
// request can't store megabyte titles, point a track at an arbitrary URL, or
// crash the Library page (next/image throws for a thumbnail host that isn't
// in next.config.ts's remotePatterns).

export const MAX_TEXT_LENGTH = 300;
export const MAX_NAME_LENGTH = 120;
export const MAX_TAGS = 30;
export const MAX_TAG_LENGTH = 64;
/** Longest track the app will accept, seconds (48h) — a sanity bound, not a product limit. */
export const MAX_DURATION_SEC = 172_800;
export const MAX_WAVEFORM_PEAKS = 20_000;
export const MAX_YOUTUBE_IMPORT = 500;

/** Trims and bounds a string; non-strings give "". */
export function cleanText(value: unknown, max: number = MAX_TEXT_LENGTH): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function isValidDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_DURATION_SEC;
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** The stored mimeType is echoed back as the audio route's Content-Type — never let a client pick e.g. text/html. */
export function normalizeAudioMime(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  return /^audio\/[a-z0-9.+-]+$/.test(v) ? v : "audio/mpeg";
}

/** Lowercases, trims, drops empties/non-strings and de-duplicates (case-insensitively), bounded in count and length. */
export function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    const tag = cleanText(raw, MAX_TAG_LENGTH);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

const BLOB_HOST_SUFFIX = ".blob.vercel-storage.com";

/**
 * A client-supplied "this file is already uploaded" URL. Must be https; when
 * the app is running against Vercel Blob it must also be a Vercel Blob host —
 * otherwise a user could register any URL as their track's storage and the
 * server would later call del() / hand it to <audio> and the analyzer.
 */
export function isAcceptableStorageUrl(value: unknown, backend: "local" | "blob"): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return backend === "blob" ? url.hostname.endsWith(BLOB_HOST_SUFFIX) : true;
}

/** YouTube thumbnails are the only remote images the app renders (next.config.ts remotePatterns). */
export function isYouTubeThumbnailUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "i.ytimg.com";
  } catch {
    return false;
  }
}

/** YouTube video ids are 11 chars of [A-Za-z0-9_-]; accept a little slack. */
export function isYouTubeVideoId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,20}$/.test(value);
}

/** True for a finite number (rejects NaN/Infinity/strings). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Waveform peaks: bounded array of finite numbers, else null. */
export function cleanWaveformPeaks(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_WAVEFORM_PEAKS) return null;
  return value.every(isFiniteNumber) ? (value as number[]) : null;
}
