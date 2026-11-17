/**
 * The database-backed genre store, job queue and classification log (tables TrackGenre, GenreJob and GenreLog,
 * prisma/genre-tables.sql). Server-only. Every function throws if the tables do not exist yet; callers use
 * genreTablesReady() first, or catch it, and answer "not set up yet".
 */
import { prisma } from "@/lib/prisma";
import { STALE_RUNNING_MS } from "@/lib/genre/constants";
import type { ClaimedJob, ClassificationLog, GenreStore, JobState, JobStore } from "@/lib/genre/jobs";
import type { StoredGenre } from "@/lib/genre/stored";
import type { GenreStatus, GenreTag } from "@/types/music";

function parseArray<T>(json: string | null | undefined): T[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/** True once prisma/genre-tables.sql has been run. Cheap: one tiny read. */
export async function genreTablesReady(): Promise<boolean> {
  try {
    await prisma.trackGenre.findFirst({ select: { trackId: true } });
    await prisma.genreJob.findFirst({ select: { id: true } });
    return true;
  } catch {
    return false;
  }
}

export function storedFromRow(row: { tagsJson: string; status: string; genre: string | null; subgenresJson: string; moodsJson: string; year?: number | null; explicit?: string | null; updatedAt: Date }): StoredGenre {
  const status: GenreStatus = row.status === "confirmed" || row.status === "needs-review" ? row.status : "auto";
  return { tags: parseArray<GenreTag>(row.tagsJson), status, genre: row.genre ?? undefined, subgenres: parseArray<string>(row.subgenresJson), moods: parseArray<string>(row.moodsJson), ...(row.year ? { year: row.year } : {}), ...(row.explicit === "explicit" || row.explicit === "clean" ? { explicit: row.explicit } : {}), updatedAt: row.updatedAt.getTime() };
}

export const prismaGenreStore: GenreStore = {
  async get(trackId) {
    const row = await prisma.trackGenre.findUnique({ where: { trackId } });
    return row ? storedFromRow(row) : null;
  },
  async save(trackId, stored) {
    const data = {
      tagsJson: JSON.stringify(stored.tags),
      status: stored.status,
      genre: stored.genre ?? null,
      subgenresJson: JSON.stringify(stored.subgenres),
      moodsJson: JSON.stringify(stored.moods),
      year: stored.year ?? null,
      explicit: stored.explicit ?? null,
    };
    await prisma.trackGenre.upsert({ where: { trackId }, create: { trackId, ...data }, update: data });
  },
};

export const prismaJobStore: JobStore = {
  async enqueue(trackIds, priority) {
    if (trackIds.length === 0) return 0;
    // The partial unique index (one queued or running job per track) makes a duplicate a no-op.
    const result = await prisma.genreJob.createMany({ data: trackIds.map((trackId) => ({ trackId, priority })), skipDuplicates: true });
    return result.count;
  },

  async claim(limit, now, userId): Promise<ClaimedJob[]> {
    const owner = userId ?? null;
    const staleBefore = new Date(now.getTime() - STALE_RUNNING_MS);
    // FOR UPDATE SKIP LOCKED: two runners at once never take the same job.
    const rows = await prisma.$queryRaw<{ id: string; trackId: string; attempts: number }[]>`
      UPDATE "GenreJob" SET "status" = 'running', "startedAt" = ${now}
      WHERE "id" IN (
        SELECT j."id" FROM "GenreJob" j JOIN "Track" t ON t."id" = j."trackId"
        WHERE ((j."status" = 'queued' AND j."runAfter" <= ${now}) OR (j."status" = 'running' AND j."startedAt" < ${staleBefore}))
          AND (${owner}::text IS NULL OR t."userId" = ${owner}::text)
        ORDER BY j."priority" ASC, j."createdAt" ASC
        LIMIT ${limit}
        FOR UPDATE OF j SKIP LOCKED
      )
      RETURNING "id", "trackId", "attempts"`;
    return rows.map((r) => ({ id: r.id, trackId: r.trackId, attempts: Number(r.attempts) }));
  },

  async complete(id, now) {
    await prisma.genreJob.update({ where: { id }, data: { status: "done", finishedAt: now, lastError: null } });
  },

  async fail(id, error, retryAt, now) {
    await prisma.genreJob.update({
      where: { id },
      data: retryAt
        ? { status: "queued", attempts: { increment: 1 }, runAfter: retryAt, lastError: error }
        : { status: "failed", attempts: { increment: 1 }, lastError: error, finishedAt: now },
    });
  },

  async release(ids) {
    if (ids.length === 0) return;
    await prisma.genreJob.updateMany({ where: { id: { in: [...ids] }, status: "running" }, data: { status: "queued" } });
  },

  async stateOf(trackIds) {
    const out = new Map<string, JobState>();
    if (trackIds.length === 0) return out;
    const rows = await prisma.genreJob.findMany({ where: { trackId: { in: [...trackIds] } }, orderBy: { createdAt: "desc" }, select: { trackId: true, status: true } });
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.trackId)) continue;
      seen.add(r.trackId);
      if (r.status === "queued" || r.status === "running" || r.status === "failed") out.set(r.trackId, r.status);
    }
    return out;
  },
};

export async function writeClassificationLog(entry: ClassificationLog): Promise<void> {
  try {
    await prisma.genreLog.create({
      data: { trackId: entry.trackId, status: entry.status, genre: entry.genre, confidence: entry.confidence, sourcesJson: JSON.stringify(entry.sources), usedLlm: entry.usedLlm },
    });
  } catch {
    // A missing log table must never fail a classification that has already been saved.
  }
}
