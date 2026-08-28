// Shared shaping logic between the track Route Handlers — keeps the
// Prisma-row -> client-JSON mapping (and the storage-backend-dependent
// sourceUrl) in one place instead of duplicated across GET/POST/PATCH.
import type { Track as PrismaTrack } from "@/generated/prisma/client";
import type { Track } from "@/types/music";
import type { TrackAnalysis } from "@/lib/audio-analysis";
import type { SerializedLyricalFingerprint } from "@/lib/lyrics";
import { getStorageBackend } from "@/lib/storage";

export interface TrackApiResponse extends Track {
  analysis: TrackAnalysis | null;
  /** null means "not looked up yet" — an empty-but-present fingerprint means "looked up, nothing found," so the client knows not to retry. */
  lyricalFingerprint: SerializedLyricalFingerprint | null;
}

export function trackSourceUrl(track: Pick<PrismaTrack, "id" | "storageKey">): string {
  return getStorageBackend() === "local" ? `/api/tracks/${track.id}/audio` : track.storageKey;
}

function isPlayPreference(value: string | null): value is "must" | "do-not" {
  return value === "must" || value === "do-not";
}

export function toTrackApiResponse(track: PrismaTrack): TrackApiResponse {
  const analysis: TrackAnalysis | null =
    track.bpm == null
      ? null
      : {
          bpm: track.bpm,
          bpmConfidence: track.bpmConfidence ?? 0,
          beatGridOffsetSec: track.beatGridOffsetSec ?? 0,
          energyOnsetSec: track.energyOnsetSec ?? 0,
          key: track.key,
          keyConfidence: track.keyConfidence ?? 0,
          camelotKey: track.camelotKey,
          breakdownAtSec: track.breakdownAtSec,
          dropAtSec: track.dropAtSec,
          waveformPeaks: track.waveformPeaksJson ? JSON.parse(track.waveformPeaksJson) : [],
          fallback: false,
        };

  const lyricalFingerprint: SerializedLyricalFingerprint | null = track.lyricalFingerprintJson
    ? JSON.parse(track.lyricalFingerprintJson)
    : null;

  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    durationSec: track.durationSec,
    addedAt: track.createdAt.getTime(),
    sourceUrl: trackSourceUrl(track),
    thumbnailUrl: track.thumbnailUrl ?? undefined,
    playPreference: isPlayPreference(track.playPreference) ? track.playPreference : undefined,
    analysis,
    lyricalFingerprint,
  };
}
