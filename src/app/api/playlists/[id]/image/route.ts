// A playlist's picture. POST (multipart "file") adds or replaces it, DELETE removes it. The account that owns the playlist and the admin may; for
// anyone else the playlist does not exist. The browser has already shrunk the picture (a few hundred KB), and the server still checks the real
// type of the bytes (JPG, PNG or WebP only) and the size, whatever the file says it is. Each change is written to the audit log.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManagePlaylist } from "@/lib/playlistAccess";
import { apiHandler, jsonError, notFound, unauthorized } from "@/lib/apiRoute";
import { checkStoredImage } from "@/lib/playlistImage";
import { removePlaylistImage, storePlaylistImage } from "@/lib/playlistImageServer";
import { isMissingTable } from "@/lib/missingTable";
import { recordAuditEvent, requestDeviceId } from "@/lib/telemetryServer";

async function loadManageable(userId: string, id: string) {
  const playlist = await prisma.playlist.findUnique({ where: { id }, select: { id: true, userId: true, name: true, theme: true } });
  return playlist && canManagePlaylist(playlist.userId, userId) ? playlist : null;
}

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();
  const { id } = await params;
  const playlist = await loadManageable(session.user.id, id);
  if (!playlist) return notFound();
  // A system playlist (Spooky Music) keeps its own look and never shows a picture, so none is stored for it.
  if (playlist.theme) return jsonError(400, "This playlist keeps its own look.");

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError(400, "Choose a picture to upload.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const check = checkStoredImage(bytes, file.type);
  if (!check.ok) return jsonError(400, check.error);

  let imageUrl: string;
  try {
    imageUrl = await storePlaylistImage(id, bytes, check.type);
  } catch (err) {
    if (isMissingTable(err)) return jsonError(503, "Playlist pictures are not set up on this server yet.");
    throw err;
  }
  await recordAuditEvent({ eventType: "image_added", actorId: session.user.id, deviceId: requestDeviceId(request), targetId: id, targetLabel: playlist.name });
  return NextResponse.json({ imageUrl }, { status: 201 });
}

async function handleDELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();
  const { id } = await params;
  const playlist = await loadManageable(session.user.id, id);
  if (!playlist) return notFound();

  let had = false;
  try {
    had = await removePlaylistImage(id);
  } catch (err) {
    if (!isMissingTable(err)) throw err; // no table, so there is no picture to remove
  }
  if (had) {
    await recordAuditEvent({ eventType: "image_removed", actorId: session.user.id, deviceId: requestDeviceId(request), targetId: id, targetLabel: playlist.name });
  }
  return new NextResponse(null, { status: 204 });
}

export const POST = apiHandler(handlePOST);
export const DELETE = apiHandler(handleDELETE);
