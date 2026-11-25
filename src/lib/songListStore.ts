/**
 * The owner's song list as stored (model SongListEntry, created by prisma/song-list.sql and filled by scripts/import-song-list.ts), read back as the rows
 * lib/songList.ts works on. Server only. Until the table exists, or while it is empty, this returns nothing and Vibe Code simply shows no list suggestions: a
 * missing table is never an error for a request.
 */
import { prisma } from "@/lib/prisma";
import type { LibraryRow } from "@/lib/djLibrary";

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
  } catch {
    return [];
  }
}
