import { describe, expect, it } from "vitest";
import type { Track as PrismaTrack } from "@/generated/prisma/client";
import { toTrackApiResponse } from "./trackApi";

function makePrismaTrack(overrides: Partial<PrismaTrack> = {}): PrismaTrack {
  return {
    id: "t1",
    userId: "u1",
    title: "Song",
    artist: "Artist",
    durationSec: 200,
    source: "local",
    storageKey: "file-1",
    mimeType: "audio/mpeg",
    thumbnailUrl: null,
    playPreference: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    bpm: null,
    bpmConfidence: null,
    beatGridOffsetSec: null,
    energyOnsetSec: null,
    key: null,
    keyConfidence: null,
    camelotKey: null,
    breakdownAtSec: null,
    dropAtSec: null,
    waveformPeaksJson: null,
    lyricalFingerprintJson: null,
    ...overrides,
  } as PrismaTrack;
}

describe("toTrackApiResponse", () => {
  it("returns a LocalTrack shape with a sourceUrl for source='local'", () => {
    const response = toTrackApiResponse(makePrismaTrack());
    expect(response.source).toBe("local");
    expect(response).toHaveProperty("sourceUrl");
    expect(response).not.toHaveProperty("youtubeVideoId");
  });

  it("returns a YouTubeTrack shape with youtubeVideoId (from storageKey) and no sourceUrl/analysis for source='youtube'", () => {
    const response = toTrackApiResponse(
      makePrismaTrack({ source: "youtube", storageKey: "dQw4w9WgXcQ", bpm: null })
    );
    expect(response.source).toBe("youtube");
    expect(response).not.toHaveProperty("sourceUrl");
    if (response.source === "youtube") {
      expect(response.youtubeVideoId).toBe("dQw4w9WgXcQ");
    }
    expect(response.analysis).toBeNull();
  });
});
