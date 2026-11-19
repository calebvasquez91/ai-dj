import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadUserPlaylistsWithSpookyUnion } from "@/lib/playlistApi";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { cleanText, MAX_NAME_LENGTH } from "@/lib/apiValidation";
import { recordAuditEvent, requestDeviceId } from "@/lib/telemetryServer";
import { loadPlaylistImages } from "@/lib/playlistImageServer";

async function handleGET() {
  const session = await auth();
  if (!session) return unauthorized();

  const playlists = await loadUserPlaylistsWithSpookyUnion(session.user.id);
  // A playlist's own picture, when it has one (an empty answer, not an error, until prisma/telemetry.sql has been run).
  const images = await loadPlaylistImages(playlists.map((p) => p.id));
  return NextResponse.json(playlists.map((p) => (images.has(p.id) ? { ...p, imageUrl: images.get(p.id) } : p)));
}

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const name = cleanText(body?.name, MAX_NAME_LENGTH) || "New Playlist";

  const playlist = await prisma.playlist.create({
    data: { userId: session.user.id, name },
  });
  await recordAuditEvent({ eventType: "playlist_created", actorId: session.user.id, deviceId: requestDeviceId(request), targetId: playlist.id, targetLabel: playlist.name });
  return NextResponse.json(
    { id: playlist.id, name: playlist.name, createdAt: playlist.createdAt.getTime(), tracks: [] },
    { status: 201 }
  );
}

export const GET = apiHandler(handleGET);
export const POST = apiHandler(handlePOST);
