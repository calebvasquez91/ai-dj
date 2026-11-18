/**
 * Builds the real pipeline for the server: the providers wired to the database cache and rate limiter, the app's own
 * identity in every outgoing request, and the keys from the server's environment. Server-only (it reads process.env keys and
 * the database); nothing here reaches the browser bundle.
 */
import { prisma } from "@/lib/prisma";
import { createAudioClassifierProvider, isClassifierEnabled } from "@/lib/genre/audioClassifier";
import { createFileTagProvider } from "@/lib/genre/fileTags";
import { readFileTags } from "@/lib/genre/fileTagReader";
import { createFingerprintResolver } from "@/lib/genre/fingerprint";
import { createFpcalcFingerprinter } from "@/lib/genre/fpcalc";
import { createLastFmProvider } from "@/lib/genre/lastFm";
import { createLlmReconciler } from "@/lib/genre/llmReconciler";
import { createMusicBrainzProvider } from "@/lib/genre/musicBrainz";
import type { JobRunnerDeps } from "@/lib/genre/jobs";
import type { PipelineDeps } from "@/lib/genre/pipeline";
import { prismaCache, prismaRateStore } from "@/lib/genre/prismaServices";
import { prismaGenreStore, prismaJobStore, writeClassificationLog } from "@/lib/genre/prismaStore";
import { PROVIDER_MIN_INTERVAL_MS, createRateLimiter } from "@/lib/genre/services";
import type { Fetcher, ProviderInput } from "@/lib/genre/types";

const DEFAULT_CONTACT = "https://ai-dj-gamma.vercel.app";

/** "QueDJ/2.0 ( contact )": the app's name and a way to reach it, which MusicBrainz and Last.fm ask every client to send. */
export function userAgent(): string {
  return `QueDJ/2.0 ( ${process.env.GENRE_CONTACT_URL || DEFAULT_CONTACT} )`;
}

const fetcher: Fetcher = (url, init) => fetch(url, init);

export function buildPipeline(): PipelineDeps {
  const cache = prismaCache();
  const limiter = createRateLimiter(PROVIDER_MIN_INTERVAL_MS, prismaRateStore());
  const ua = userAgent();
  return {
    fileTags: createFileTagProvider({ readTags: readFileTags }),
    fingerprint: createFingerprintResolver({
      fingerprinter: createFpcalcFingerprinter(process.env.FPCALC_PATH),
      fetcher,
      cache,
      limiter,
      userAgent: ua,
      apiKey: () => process.env.ACOUSTID_API_KEY,
    }),
    musicbrainz: createMusicBrainzProvider({ fetcher, cache, limiter, userAgent: ua }),
    lastfm: createLastFmProvider({ fetcher, cache, limiter, userAgent: ua, apiKey: () => process.env.LASTFM_API_KEY }),
    // No audio genre model is bundled (see README), so with CLASSIFIER_ENABLED on this still has nothing to run until one is plugged in here.
    audioClassifier: createAudioClassifierProvider({ enabled: () => isClassifierEnabled(), model: null }),
    llm: createLlmReconciler({ fetcher, cache, apiKey: () => process.env.ANTHROPIC_API_KEY }),
  };
}

export async function loadTrackInput(trackId: string): Promise<ProviderInput | null> {
  const t = await prisma.track.findUnique({ where: { id: trackId }, select: { id: true, title: true, artist: true, durationSec: true, source: true, storageKey: true, mimeType: true } });
  if (!t) return null;
  const local = t.source === "local";
  return { trackId: t.id, title: t.title, artist: t.artist, durationSec: t.durationSec, source: local ? "local" : "youtube", ...(local ? { storageKey: t.storageKey, mimeType: t.mimeType } : {}) };
}

export function buildRunnerDeps(): JobRunnerDeps {
  return { jobs: prismaJobStore, store: prismaGenreStore, pipeline: buildPipeline(), loadTrack: loadTrackInput, writeLog: writeClassificationLog };
}
