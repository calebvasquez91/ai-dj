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
    buildDropPairsJson: null,
    waveformPeaksJson: null,
    lyricalFingerprintJson: null,
    hotCueOverridesJson: null,
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

describe("per-person data on a shared song", () => {
  const song = {
    id: "t1",
    userId: "someone-else",
    title: "T",
    artist: "A",
    durationSec: 10,
    source: "local",
    storageKey: "https://x.public.blob.vercel-storage.com/t.mp3",
    mimeType: "audio/mpeg",
    thumbnailUrl: null,
    playPreference: "must", // the pre-sharing column: ignored
    createdAt: new Date(0),
    hotCueOverridesJson: '{"1":5}', // ignored too
    tagsJson: '["halloween"]', // tags are shared, so kept
    bpm: null,
    bpmSource: null,
    buildDropPairsJson: null,
    waveformPeaksJson: null,
    lyricalFingerprintJson: null,
  } as unknown as Parameters<typeof toTrackApiResponse>[0];

  it("takes the must / do-not-play mark and hot cues from the reader's own data, not from the shared song", () => {
    const mine = toTrackApiResponse(song, { playPreference: "do-not", hotCueOverridesJson: '{"2":9}' });
    expect(mine.playPreference).toBe("do-not");
    expect(mine.hotCueOverrides).toEqual({ "2": 9 });
    expect(mine.tags).toEqual(["halloween"]);
  });

  it("shows nothing when the reader has set nothing, whatever the shared song's old columns say", () => {
    for (const none of [undefined, {}, { playPreference: null, hotCueOverridesJson: null }]) {
      const r = toTrackApiResponse(song, none);
      expect(r.playPreference).toBeUndefined();
      expect(r.hotCueOverrides).toBeUndefined();
    }
  });

  it("ignores a value that is not a real mark", () => {
    expect(toTrackApiResponse(song, { playPreference: "maybe" }).playPreference).toBeUndefined();
  });
});
