/**
 * What the Route Handlers share for genre data: reading a batch of tracks' genre records, queueing jobs for tracks that
 * were just added, and shaping a stored record into the fields a Track carries. Server-only. Every function here treats
 * "the genre tables do not exist yet" as "no genre data" and never throws, so the library keeps working before
 * prisma/genre-tables.sql has been run.
 */
import { prisma } from "@/lib/prisma";
import { PRIORITY_REQUESTED } from "@/lib/genre/constants";
import { disagreesWithManual } from "@/lib/genre/combine";
import { prismaJobStore, storedFromRow } from "@/lib/genre/prismaStore";
import type { StoredGenre } from "@/lib/genre/stored";
import type { GenreStatus, GenreTag } from "@/types/music";

/** The genre fields a Track carries in the API: the raw tags, the status and the derived summary. */
export interface TrackGenreFields {
  genreTags: GenreTag[];
  genreStatus: GenreStatus;
  genre?: string;
  subgenres: string[];
  moods: string[];
  year?: number;
  explicit?: "explicit" | "clean";
  /** A confirmed track whose sources now point somewhere else (a re-run flagged it). */
  genreDisagrees?: boolean;
}

export function fieldsFromStored(stored: StoredGenre): TrackGenreFields {
  return {
    genreTags: stored.tags,
    genreStatus: stored.status,
    ...(stored.genre ? { genre: stored.genre } : {}),
    subgenres: stored.subgenres,
    moods: stored.moods,
    ...(stored.year ? { year: stored.year } : {}),
    ...(stored.explicit ? { explicit: stored.explicit } : {}),
    ...(disagreesWithManual(stored.tags) ? { genreDisagrees: true } : {}),
  };
}

/** The genre fields of each given track that has a record. Empty (not an error) if the tables are not there yet. */
export async function loadGenreFields(trackIds: readonly string[]): Promise<Map<string, TrackGenreFields>> {
  const out = new Map<string, TrackGenreFields>();
  if (trackIds.length === 0) return out;
  try {
    const rows = await prisma.trackGenre.findMany({ where: { trackId: { in: [...trackIds] } } });
    for (const row of rows) out.set(row.trackId, fieldsFromStored(storedFromRow(row)));
  } catch {
    // Tables not created yet: the library simply has no genres.
  }
  return out;
}

/** Queues classification for tracks that were just added. Never throws; returns how many were queued. */
export async function queueNewTracks(trackIds: readonly string[], priority = PRIORITY_REQUESTED): Promise<number> {
  try {
    return await prismaJobStore.enqueue(trackIds, priority);
  } catch {
    return 0;
  }
}

/** Queues the given tracks that have never been classified (a re-imported track keeps what it has). Never throws. */
export async function queueUnclassified(trackIds: readonly string[], priority = PRIORITY_REQUESTED): Promise<number> {
  try {
    const rows = await prisma.track.findMany({ where: { id: { in: [...trackIds] }, genreInfo: null }, select: { id: true } });
    return await prismaJobStore.enqueue(rows.map((r) => r.id), priority);
  } catch {
    return 0;
  }
}

/** Which of the given track ids belong to the user. */
export async function ownedTrackIds(userId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.track.findMany({ where: { userId, id: { in: [...ids] } }, select: { id: true } });
  return rows.map((r) => r.id);
}
