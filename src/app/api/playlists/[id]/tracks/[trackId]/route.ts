import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManagePlaylist } from "@/lib/playlistAccess";
import { recordAdminPlaylistAction } from "@/lib/adminAudit";
import { apiHandler, notFound, unauthorized } from "@/lib/apiRoute";

async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; trackId: string }> }
) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id, trackId } = await params;
  const playlist = await prisma.playlist.findUnique({ where: { id } });
  if (!playlist || !canManagePlaylist(playlist.userId, session.user.id)) {
    return notFound();
  }

  const removed = await prisma.track.findUnique({ where: { id: trackId }, select: { title: true, artist: true } });
  await prisma.playlistTrack.deleteMany({ where: { playlistId: id, trackId } });
  await recordAdminPlaylistAction({ actorId: session.user.id, action: "playlist.remove-song", playlist, detail: removed ? `${removed.title} - ${removed.artist}` : trackId });
  return new NextResponse(null, { status: 204 });
}

export const DELETE = apiHandler(handleDELETE);
