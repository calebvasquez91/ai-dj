// PATCH /api/admin/music/<song id>: the admin's edit of one song from the Music catalog: artist, song name, BPM, key, tags. It changes the shared
// song, so every account sees it; each edit is logged (lib/adminAudit.ts). Genres have their own route (api/tracks/[id]/genre). Admin only.
import { NextResponse } from "next/server";
import { apiHandler, jsonError, notFound } from "@/lib/apiRoute";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { prisma } from "@/lib/prisma";
import { recordAdminLibraryEdit } from "@/lib/adminAudit";
import { MUSIC_SELECT, parseMusicEdit, toMusicRow } from "@/lib/adminMusic";

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await feedbackOwnerSession();
  if (!session) return jsonError(404, "Not found.");
  const { id } = await params;

  const edit = parseMusicEdit(await request.json().catch(() => null));
  if (!edit.ok) return jsonError(400, edit.error);

  const before = await prisma.track.findUnique({ where: { id }, select: { id: true, artist: true, title: true, userId: true, bpm: true, key: true, tagsJson: true } });
  if (!before) return notFound("Song not found.");

  const updated = await prisma.track.update({ where: { id }, data: edit.data, select: MUSIC_SELECT });
  await recordAdminLibraryEdit({ actorId: session.user.id, track: before, changed: edit.data });
  return NextResponse.json(toMusicRow(updated));
}

export const PATCH = apiHandler(handlePATCH);
