/** Reads what the stats screen needs from the database (the counts and the classification log). Server-only. */
import { prisma } from "@/lib/prisma";
import { genreTablesReady } from "@/lib/genre/prismaStore";
import { computeGenreStats, type GenreStats } from "@/lib/genre/stats";

/** The newest classifications the stats are computed from: enough to be representative, bounded so the page stays quick. */
const LOG_WINDOW = 5000;

export type GenreStatsResult = { ok: true; stats: GenreStats } | { ok: false; reason: "no-table" | "error" };

export async function loadGenreStats(): Promise<GenreStatsResult> {
  try {
    if (!(await genreTablesReady())) return { ok: false, reason: "no-table" };
    const [totalTracks, records, classified, needsReview, confirmed, logs] = await Promise.all([
      prisma.track.count(),
      prisma.trackGenre.count(),
      prisma.trackGenre.count({ where: { genre: { not: null } } }),
      prisma.trackGenre.count({ where: { status: "needs-review" } }),
      prisma.trackGenre.count({ where: { status: "confirmed" } }),
      prisma.genreLog.findMany({ orderBy: { createdAt: "desc" }, take: LOG_WINDOW }),
    ]);
    return { ok: true, stats: computeGenreStats({ totalTracks, records, classified, needsReview, confirmed, logs }) };
  } catch (err) {
    console.error("[genre stats] could not load:", err);
    return { ok: false, reason: "error" };
  }
}
