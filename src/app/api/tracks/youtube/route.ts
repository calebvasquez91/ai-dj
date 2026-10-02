import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { toTrackApiResponse } from "@/lib/trackApi";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import {
  cleanText,
  isValidDuration,
  isYouTubeThumbnailUrl,
  isYouTubeVideoId,
  MAX_YOUTUBE_IMPORT,
} from "@/lib/apiValidation";

interface ImportItem {
  videoId: string;
  title: string;
  artist: string;
  durationSec: number;
  thumbnailUrl?: string;
}

function isImportItem(value: unknown): value is ImportItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    isYouTubeVideoId(v.videoId) &&
    typeof v.title === "string" &&
    typeof v.artist === "string" &&
    isValidDuration(v.durationSec) &&
    (v.thumbnailUrl === undefined || typeof v.thumbnailUrl === "string")
  );
}

// Persists metadata for videos the client already resolved via the YouTube
// Data API (using the user's own OAuth token, never sent to this server) —
// this route never talks to Google itself, it just records plain track
// metadata the same way the local-upload route does.
async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  const rawTracks: unknown = body?.tracks;
  if (Array.isArray(rawTracks) && rawTracks.length > MAX_YOUTUBE_IMPORT) {
    return NextResponse.json({ error: `Import at most ${MAX_YOUTUBE_IMPORT} videos at a time.` }, { status: 400 });
  }
  // Duplicate video ids within one request would be one row anyway
  // (@@unique userId+storageKey) — collapse them so createMany/skipDuplicates
  // and the follow-up lookup see a clean list.
  const seen = new Set<string>();
  const items: ImportItem[] | null = Array.isArray(rawTracks)
    ? rawTracks.filter(isImportItem).filter((i) => !seen.has(i.videoId) && seen.add(i.videoId))
    : null;
  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Expected a non-empty tracks array." }, { status: 400 });
  }

  await prisma.track.createMany({
    data: items.map((item) => ({
      userId: session.user.id,
      title: cleanText(item.title) || "Untitled",
      artist: cleanText(item.artist),
      durationSec: item.durationSec,
      source: "youtube",
      storageKey: item.videoId,
      mimeType: "",
      // TrackThumbnail renders this with next/image, which throws for any host
      // outside next.config.ts remotePatterns (i.ytimg.com) — an arbitrary URL
      // here would crash the Library page for this account on every load.
      thumbnailUrl: isYouTubeThumbnailUrl(item.thumbnailUrl) ? item.thumbnailUrl : null,
    })),
    skipDuplicates: true, // @@unique([userId, storageKey]) — re-importing an already-imported video is a no-op
  });

  const tracks = await prisma.track.findMany({
    where: {
      userId: session.user.id,
      source: "youtube",
      storageKey: { in: items.map((item) => item.videoId) },
    },
  });
  return NextResponse.json(tracks.map(toTrackApiResponse), { status: 201 });
}

export const POST = apiHandler(handlePOST);
