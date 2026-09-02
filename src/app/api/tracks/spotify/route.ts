import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { toTrackApiResponse } from "@/lib/trackApi";

interface ImportItem {
  spotifyTrackId: string;
  title: string;
  artist: string;
  durationSec: number;
  thumbnailUrl?: string;
}

function isImportItem(value: unknown): value is ImportItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.spotifyTrackId === "string" &&
    typeof v.title === "string" &&
    typeof v.artist === "string" &&
    Number.isFinite(v.durationSec) &&
    (v.thumbnailUrl === undefined || typeof v.thumbnailUrl === "string")
  );
}

// Mirrors /api/tracks/youtube — persists metadata for tracks the client
// already resolved via the Spotify Web API (using the user's own OAuth
// token, never sent to this server). This route never talks to Spotify
// itself, it just records plain track metadata.
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const body = await request.json().catch(() => null);
  const rawTracks: unknown = body?.tracks;
  const items: ImportItem[] | null = Array.isArray(rawTracks) ? rawTracks.filter(isImportItem) : null;
  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Expected a non-empty tracks array." }, { status: 400 });
  }

  await prisma.track.createMany({
    data: items.map((item) => ({
      userId: session.user.id,
      title: item.title,
      artist: item.artist,
      durationSec: item.durationSec,
      source: "spotify",
      storageKey: item.spotifyTrackId,
      mimeType: "",
      thumbnailUrl: item.thumbnailUrl ?? null,
    })),
    skipDuplicates: true, // @@unique([userId, storageKey]) — re-importing an already-imported track is a no-op
  });

  const tracks = await prisma.track.findMany({
    where: {
      userId: session.user.id,
      source: "spotify",
      storageKey: { in: items.map((item) => item.spotifyTrackId) },
    },
  });
  return NextResponse.json(tracks.map(toTrackApiResponse), { status: 201 });
}
