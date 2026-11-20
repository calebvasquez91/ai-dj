// PATCH /api/admin/music/<song id>: the admin's edit of one song from the Music catalog: artist, song name, BPM, key, tags. It changes the shared
// song, so every account sees it; each edit is logged (lib/adminAudit.ts). Genres have their own route (api/tracks/[id]/genre). Admin only.
//
// A rename also goes onto the song's play history (PlayEvent keeps its own copy of the title and artist), or the listening stats would list the one song
// twice. BPM and key belong to the app's analysis of the song, so they are only accepted for a song that has been analysed, and they are marked as set by
// hand (Track.bpmSource "manual") so that the app's own re-analysis does not write over them (api/tracks/[id] leaves a manual song's tempo and key alone).
import { NextResponse } from "next/server";
import { apiHandler, jsonError, notFound } from "@/lib/apiRoute";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { prisma } from "@/lib/prisma";
import { recordAdminLibraryEdit } from "@/lib/adminAudit";
import { MANUAL_BPM_SOURCE, MUSIC_SELECT, editsTempoOrKey, parseMusicEdit, toMusicRow } from "@/lib/adminMusic";

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await feedbackOwnerSession();
  if (!session) return jsonError(404, "Not found.");
  const { id } = await params;

  const edit = parseMusicEdit(await request.json().catch(() => null));
  if (!edit.ok) return jsonError(400, edit.error);

  const before = await prisma.track.findUnique({ where: { id }, select: { id: true, artist: true, title: true, userId: true, bpm: true, key: true, tagsJson: true } });
  if (!before) return notFound("Song not found.");
  if (editsTempoOrKey(edit.data) && before.bpm == null) {
    return jsonError(409, "This song has not been analysed yet (that happens the first time it plays), so there is no tempo or key to correct.");
  }

  const data = editsTempoOrKey(edit.data) ? { ...edit.data, bpmSource: MANUAL_BPM_SOURCE } : edit.data;
  const renamed = edit.data.artist !== undefined || edit.data.title !== undefined;
  const history = {
    ...(edit.data.artist !== undefined ? { artist: edit.data.artist } : {}),
    ...(edit.data.title !== undefined ? { title: edit.data.title } : {}),
  };
  const [updated] = await prisma.$transaction([
    prisma.track.update({ where: { id }, data, select: MUSIC_SELECT }),
    ...(renamed ? [prisma.playEvent.updateMany({ where: { trackId: id }, data: history })] : []),
  ]);
  await recordAdminLibraryEdit({ actorId: session.user.id, track: before, changed: edit.data });
  return NextResponse.json(toMusicRow(updated));
}

export const PATCH = apiHandler(handlePATCH);
