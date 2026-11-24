// PUT /api/playlists/:id/holiday with { holiday: "<id>" | null }: sets or clears the playlist's holiday theme. The account that owns the playlist and the
// admin may; for anyone else the playlist does not exist. A system playlist (Spooky Music) never takes one: it keeps its own look.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManagePlaylist } from "@/lib/playlistAccess";
import { apiHandler, jsonError, notFound, unauthorized } from "@/lib/apiRoute";
import { isCustomThemeId, isHolidayId } from "@/lib/holidayThemes";
import { loadPlaylistHolidays, setPlaylistHoliday } from "@/lib/playlistHolidayServer";
import { isMissingTable } from "@/lib/missingTable";

async function handlePUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();
  const { id } = await params;
  const playlist = await prisma.playlist.findUnique({ where: { id }, select: { userId: true, theme: true } });
  if (!playlist || !canManagePlaylist(playlist.userId, session.user.id)) return notFound();
  if (playlist.theme) return jsonError(400, "This playlist keeps its own look.");

  // A custom theme (GTA6) is put on a playlist by hand and stays: it is not a holiday theme, so this route neither replaces nor clears it.
  if (isCustomThemeId((await loadPlaylistHolidays([id])).get(id))) return jsonError(400, "This playlist has its own custom theme.");

  const body = (await request.json().catch(() => null)) as { holiday?: unknown } | null;
  const holiday = body?.holiday;
  if (holiday !== null && !isHolidayId(holiday)) return jsonError(400, "That is not one of the holiday themes.");
  try {
    await setPlaylistHoliday(id, holiday);
  } catch (err) {
    if (isMissingTable(err)) return jsonError(503, "Holiday themes are not set up on this server yet.");
    throw err;
  }
  return NextResponse.json({ holiday });
}

export const PUT = apiHandler(handlePUT);
