/**
 * FingerprintProvider (AcoustID + Chromaprint): for a file with no usable tags, fingerprint the audio, ask AcoustID which
 * MusicBrainz recording it is, and hand that recording id to the MusicBrainz provider. It produces no genres itself; it only
 * improves matching, so it returns a recording id, not tags.
 *
 * The fingerprinting is injected: fpcalc.ts runs the `fpcalc` command-line tool when FPCALC_PATH points at one. The tool is
 * not bundled with the app (Chromaprint's own builds link FFmpeg, whose license depends on how it was built), so without it
 * this provider is simply off and the pipeline goes on to the other sources.
 */
import { createHash } from "node:crypto";
import { cachedJsonGet, HttpError } from "@/lib/genre/http";
import type { Fetcher, ProviderCacheStore, ProviderInput, RateLimiter } from "@/lib/genre/types";

const ACOUSTID = "https://api.acoustid.org/v2/lookup";

export interface Fingerprint {
  durationSec: number;
  fingerprint: string;
}

interface AcoustIdResponse {
  status?: string;
  results?: { id?: string; score?: number; recordings?: { id: string }[] }[];
}

/** An AcoustID match below this score is not trusted: a wrong recording would give the track another song's genres. */
export const MIN_FINGERPRINT_SCORE = 0.8;

export interface FingerprintResolverOptions {
  /** Null when no fingerprinting tool is available. */
  fingerprinter: ((input: ProviderInput) => Promise<Fingerprint | null>) | null;
  fetcher: Fetcher;
  cache: ProviderCacheStore;
  limiter: RateLimiter;
  userAgent: string;
  apiKey: () => string | undefined;
}

export interface FingerprintMatch {
  recordingMbid: string | null;
  score?: number;
  note?: string;
  /** It did not run (no key, no tool, no file): not a miss. */
  skipped?: boolean;
}

export interface FingerprintResolver {
  resolve(input: ProviderInput): Promise<FingerprintMatch>;
}

export function createFingerprintResolver({ fingerprinter, fetcher, cache, limiter, userAgent, apiKey }: FingerprintResolverOptions): FingerprintResolver {
  return {
    async resolve(input) {
      if (input.source !== "local" || !input.storageKey) return { recordingMbid: null, skipped: true, note: "no audio file to fingerprint" };
      const key = apiKey();
      if (!key) return { recordingMbid: null, skipped: true, note: "ACOUSTID_API_KEY is not set" };
      if (!fingerprinter) return { recordingMbid: null, skipped: true, note: "no fingerprinting tool (FPCALC_PATH is not set)" };
      try {
        const fp = await fingerprinter(input);
        if (!fp) return { recordingMbid: null, note: "the file could not be fingerprinted" };
        const body = new URLSearchParams({ client: key, meta: "recordingids", duration: String(Math.round(fp.durationSec)), fingerprint: fp.fingerprint, format: "json" });
        const digest = createHash("sha1").update(fp.fingerprint).digest("hex");
        const res = await cachedJsonGet<AcoustIdResponse>({
          provider: "acoustid",
          url: ACOUSTID,
          cacheKey: `${Math.round(fp.durationSec)}:${digest}`,
          fetcher,
          cache,
          limiter,
          headers: { "User-Agent": userAgent, "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        const best = (res?.results ?? [])
          .filter((r) => (r.score ?? 0) >= MIN_FINGERPRINT_SCORE && (r.recordings?.length ?? 0) > 0)
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
        if (!best) return { recordingMbid: null, note: "AcoustID has no confident match" };
        return { recordingMbid: best.recordings![0].id, score: best.score };
      } catch (err) {
        return { recordingMbid: null, note: err instanceof HttpError ? err.message : "fingerprint lookup failed" };
      }
    },
  };
}
