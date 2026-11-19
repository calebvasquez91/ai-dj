// Server-only. A playlist's holiday theme, kept in the PlaylistHoliday table (prisma/holiday-themes.sql) beside the playlist. Reads are best effort:
// with the table missing, playlists simply have no holiday theme.
import { prisma } from "@/lib/prisma";
import type { HolidayId } from "@/lib/holidayThemes";

export async function loadPlaylistHolidays(playlistIds: readonly string[]): Promise<Map<string, string>> {
  if (playlistIds.length === 0) return new Map();
  try {
    const rows = await prisma.playlistHoliday.findMany({ where: { playlistId: { in: [...playlistIds] } }, select: { playlistId: true, holiday: true } });
    return new Map(rows.map((r) => [r.playlistId, r.holiday]));
  } catch {
    return new Map();
  }
}

/** Sets a playlist's holiday theme, or clears it with null. */
export async function setPlaylistHoliday(playlistId: string, holiday: HolidayId | null): Promise<void> {
  if (holiday === null) {
    await prisma.playlistHoliday.deleteMany({ where: { playlistId } });
    return;
  }
  await prisma.playlistHoliday.upsert({ where: { playlistId }, create: { playlistId, holiday }, update: { holiday } });
}
