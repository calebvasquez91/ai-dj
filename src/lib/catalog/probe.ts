/**
 * The small pure checks behind scripts/check-jamendo.mts, the first real run against Jamendo's live API. They turn what
 * a real response looks like into answers to the questions the catalog code can't settle from Jamendo's documentation:
 * does a stream URL carry the client id, does the audio host allow Web Audio to read it from our origin, and how much of
 * the catalog the license rules leave usable.
 */
import { parseLicenseUrl } from "@/lib/catalog/license";

export interface StreamUrlInfo {
  host: string;
  /** True when the client id appears anywhere in the URL. */
  carriesClientId: boolean;
  /** The query parameters whose value contains the client id (e.g. a `from=app-<id>` style one). */
  paramsWithClientId: string[];
}

export function streamUrlInfo(url: string, clientId: string): StreamUrlInfo {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { host: "(not a URL)", carriesClientId: false, paramsWithClientId: [] };
  }
  const paramsWithClientId = clientId ? [...parsed.searchParams.entries()].filter(([, v]) => v.includes(clientId)).map(([k]) => k) : [];
  return { host: parsed.hostname, carriesClientId: clientId !== "" && url.includes(clientId), paramsWithClientId };
}

export type CorsVerdict = "allowed" | "no-cors-header" | "other-origin-only";

/** Whether a response's CORS headers let `origin` read it, which Web Audio's decodeAudioData on a fetched file needs. */
export function corsVerdict(headers: { get(name: string): string | null }, origin: string): CorsVerdict {
  const allow = headers.get("access-control-allow-origin");
  if (allow === null) return "no-cors-header";
  const value = allow.trim();
  return value === "*" || value.toLowerCase() === origin.toLowerCase() ? "allowed" : "other-origin-only";
}

export interface LicenseMix {
  total: number;
  /** Count per license code (by, by-sa, by-nc, cc0 ...), plus "unreadable". */
  byCode: Record<string, number>;
  /** How many of the total the default license policy would let through. */
  usable: number;
}

/** What a page of raw Jamendo `license_ccurl` values is made of. */
export function licenseMix(licenseUrls: (string | null | undefined)[]): LicenseMix {
  const byCode: Record<string, number> = {};
  let usable = 0;
  for (const url of licenseUrls) {
    const license = parseLicenseUrl(url);
    const key = license ? license.code : "unreadable";
    byCode[key] = (byCode[key] ?? 0) + 1;
    if (license && !license.nonCommercial && !license.noDerivatives && !license.shareAlike) usable += 1;
  }
  return { total: licenseUrls.length, byCode, usable };
}
