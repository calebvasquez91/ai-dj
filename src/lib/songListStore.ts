/**
 * The owner's song list as stored (model SongListEntry, created by prisma/song-list.sql and filled by scripts/import-song-list.ts), read back as the rows
 * lib/songList.ts works on. Server only. While the table does not exist yet this returns nothing and Create with DJ simply shows no list suggestions. Any other
 * failure (a lost connection, a column that is missing) is logged, so it is never mistaken for "nothing in the list"; it still returns nothing, because the
 * suggestions are an extra and must not stop the playlist.
 */
import { prisma } from "@/lib/prisma";
import type { LibraryRow } from "@/lib/djLibrary";
import { isMissingTableError } from "@/lib/songListAccess";

export async function loadSongListRows(): Promise<LibraryRow[]> {
  try {
    const rows = await prisma.songListEntry.findMany({ orderBy: { id: "asc" } });
    return rows.map((r) => ({
      id: r.id,
      playlist: r.playlist,
      title: r.title,
      artist: r.artist,
      moods: r.moods.split(",").map((m) => m.trim()).filter(Boolean),
      year: r.year,
      energy: r.energy,
      genre: r.genre,
      subGenre: r.subGenre,
      bpm: r.bpm,
      camelot: r.camelot,
      explicit: r.explicit,
      durationSec: r.durationSec,
    }));
  } catch (err) {
    if (!isMissingTableError(err)) console.error("Create with DJ: could not read the song list", err instanceof Error ? err.message : err);
    return [];
  }
}
