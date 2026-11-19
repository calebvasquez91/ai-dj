import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManagePlaylist } from "@/lib/playlistAccess";
import { recordAdminPlaylistAction } from "@/lib/adminAudit";
import { loadPlaylist, toPlaylistApiResponse } from "@/lib/playlistApi";
import { loadUserTrackData } from "@/lib/trackUserData";
import { apiHandler, notFound, unauthorized } from "@/lib/apiRoute";
import { cleanText, MAX_NAME_LENGTH } from "@/lib/apiValidation";
import { recordAuditEvent, requestDeviceId } from "@/lib/telemetryServer";

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id } = await params;
  const existing = await prisma.playlist.findUnique({ where: { id } });
  if (!existing || !canManagePlaylist(existing.userId, session.user.id)) {
    return notFound();
  }

  const body = await request.json().catch(() => null);
  const name = cleanText(body?.name, MAX_NAME_LENGTH);
  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });

  await prisma.playlist.update({ where: { id }, data: { name } });
  await recordAdminPlaylistAction({ actorId: session.user.id, action: "playlist.rename", playlist: existing, detail: `${existing.name} -> ${name}` });
  await recordAuditEvent({ eventType: "playlist_renamed", actorId: session.user.id, deviceId: requestDeviceId(request), targetId: id, targetLabel: `${existing.name} -> ${name}` });
  const playlist = await loadPlaylist(id);
  return NextResponse.json(toPlaylistApiResponse(playlist!, await loadUserTrackData(session.user.id)));
}

async function handleDELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id } = await params;
  const existing = await prisma.playlist.findUnique({ where: { id } });
  if (!existing || !canManagePlaylist(existing.userId, session.user.id)) {
    return notFound();
  }
  if (existing.theme) {
    // System playlists (e.g. Spooky Music) aren't user-deletable — the
    // Spooky Music card on Home always needs somewhere to link to.
    return NextResponse.json({ error: "This playlist can't be deleted." }, { status: 400 });
  }

  await prisma.playlist.delete({ where: { id } });
  await recordAdminPlaylistAction({ actorId: session.user.id, action: "playlist.delete", playlist: existing });
  await recordAuditEvent({ eventType: "playlist_deleted", actorId: session.user.id, deviceId: requestDeviceId(request), targetId: id, targetLabel: existing.name });
  return new NextResponse(null, { status: 204 });
}

export const PATCH = apiHandler(handlePATCH);
export const DELETE = apiHandler(handleDELETE);
