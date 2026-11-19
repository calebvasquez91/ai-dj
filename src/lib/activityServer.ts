// Server-only. What the admin Activity page and its CSV export read: the overview, devices, uploads, the library activity log, playtime by day and
// week, genre counts, and the system's health. Every section is read on its own, so a table that does not exist yet (prisma/telemetry.sql not
// run) or a database hiccup blanks only that section. Admin only: the page and the export route check that first.
import { prisma } from "@/lib/prisma";
import { isMissingTable } from "@/lib/missingTable";
import { parseArray } from "@/lib/genre/prismaStore";
import type { GenreTag } from "@/types/music";
import { list } from "@vercel/blob";
import { genreCountRows, limitBytes, type ActivityFilter, type GenreCountRow } from "@/lib/activity";
import { averageSessionSeconds, isActiveNow } from "@/lib/telemetry";

export type Section<T> = { ok: true; data: T } | { ok: false; reason: "no-table" | "error" };

async function section<T>(read: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "no-table" };
    console.error("[activity] could not load a section:", err);
    return { ok: false, reason: "error" };
  }
}

function dateRange(filter: Pick<ActivityFilter, "from" | "to">) {
  return filter.from || filter.to ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {};
}

const emailOf = (u: { email: string; name: string | null } | undefined) => (u ? (u.name ? `${u.name} (${u.email})` : u.email) : "(deleted account)");

async function emailsFor(ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, email: true, name: true } });
  return new Map(users.map((u) => [u.id, emailOf(u)]));
}

export interface DeviceRow {
  id: string;
  platform: string;
  os: string;
  appVersion: string;
  account: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  activeNow: boolean;
}

export function loadDevices(now = Date.now()): Promise<Section<DeviceRow[]>> {
  return section(async () => {
    const devices = await prisma.device.findMany({ orderBy: { lastSeenAt: "desc" }, take: 200 });
    const emails = await emailsFor(devices.map((d) => d.lastUserId));
    return devices.map((d) => ({
      id: d.id,
      platform: d.platform,
      os: d.os,
      appVersion: d.appVersion,
      account: d.lastUserId ? (emails.get(d.lastUserId) ?? "(deleted account)") : "—",
      firstSeenAt: d.firstSeenAt,
      lastSeenAt: d.lastSeenAt,
      activeNow: isActiveNow(d.lastSeenAt, now),
    }));
  });
}

export interface UploadRow {
  at: Date;
  deviceId: string | null;
  account: string;
  title: string;
}

export function loadUploads(filter: ActivityFilter, take = 300): Promise<Section<UploadRow[]>> {
  return section(async () => {
    const rows = await prisma.uploadRecord.findMany({ where: dateRange(filter), orderBy: { createdAt: "desc" }, take });
    const emails = await emailsFor(rows.map((r) => r.userId));
    return rows.map((r) => ({ at: r.createdAt, deviceId: r.deviceId, account: emails.get(r.userId) ?? "(deleted account)", title: r.trackTitle }));
  });
}

export interface AuditRow {
  at: Date;
  eventType: string;
  actorRole: string;
  deviceId: string | null;
  label: string;
}

export function loadAuditLog(filter: ActivityFilter, take = 300): Promise<Section<AuditRow[]>> {
  return section(async () => {
    const rows = await prisma.auditEvent.findMany({
      where: { ...dateRange(filter), ...(filter.type ? { eventType: filter.type } : {}) },
      orderBy: { createdAt: "desc" },
      take,
    });
    return rows.map((r) => ({ at: r.createdAt, eventType: r.eventType, actorRole: r.actorRole, deviceId: r.deviceId, label: r.targetLabel ?? r.targetId ?? "" }));
  });
}

export interface Overview {
  tracks: number;
  playlists: number;
  devices: number | null;
  activeNow: number | null;
  totalPlaySeconds: number | null;
}

export function loadOverview(now = Date.now()): Promise<Section<Overview>> {
  return section(async () => {
    const [tracks, playlists] = await Promise.all([prisma.track.count({ where: { source: "local" } }), prisma.playlist.count()]);
    const orNull = async <T>(read: () => Promise<T>): Promise<T | null> => read().catch(() => null);
    const [devices, activeNow, plays] = await Promise.all([
      orNull(() => prisma.device.count()),
      orNull(() => prisma.device.count({ where: { lastSeenAt: { gte: new Date(now - 75_000) } } })),
      orNull(() => prisma.playEvent.aggregate({ _sum: { seconds: true } })),
    ]);
    return { tracks, playlists, devices, activeNow, totalPlaySeconds: plays ? (plays._sum.seconds ?? 0) : null };
  });
}

export interface PlaytimeReport {
  perDay: { key: string; seconds: number }[];
  perWeek: { key: string; seconds: number }[];
  averageSessionSeconds: number | null;
  sessions: number | null;
}

/** Playtime for the last 8 weeks by day (the last 14) and by week, and the average session length over the last 30 days. Summed in the database, by UTC day and by week (Monday first), so no play row is read into memory. */
export function loadPlaytime(now = Date.now()): Promise<Section<PlaytimeReport>> {
  return section(async () => {
    const since = new Date(now - 56 * 86_400_000);
    const [perDay, perWeek] = await Promise.all([
      prisma.$queryRaw<{ key: string; seconds: number }[]>`
        SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS key, SUM("seconds")::float8 AS seconds
        FROM "PlayEvent" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ key: string; seconds: number }[]>`
        SELECT to_char(date_trunc('week', "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS key, SUM("seconds")::float8 AS seconds
        FROM "PlayEvent" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    ]);
    const sessions = await prisma.appSession
      .findMany({ where: { startedAt: { gte: new Date(now - 30 * 86_400_000) } }, select: { startedAt: true, lastBeatAt: true } })
      .catch(() => null);
    return {
      perDay: perDay.map((r) => ({ key: r.key, seconds: Number(r.seconds) })).slice(-14),
      perWeek: perWeek.map((r) => ({ key: r.key, seconds: Number(r.seconds) })).slice(-8),
      averageSessionSeconds: sessions ? averageSessionSeconds(sessions) : null,
      sessions: sessions ? sessions.length : null,
    };
  });
}

export interface GenreCounts {
  genres: GenreCountRow[];
  needsReview: number;
  unclassified: number;
}

export function loadGenreCounts(): Promise<Section<GenreCounts>> {
  return section(async () => {
    // One read of the classification rows gives the genre counts, the review queue and the classified total; only the library size is a second query.
    const [rows, tracks] = await Promise.all([
      prisma.trackGenre.findMany({ select: { genre: true, status: true, tagsJson: true } }),
      prisma.track.count({ where: { source: "local" } }),
    ]);
    const classified = rows.filter((r) => r.genre !== null).length;
    const needsReview = rows.filter((r) => r.status === "needs-review").length;
    const genres = genreCountRows(rows.map((r) => ({ genre: r.genre, tags: parseArray<GenreTag>(r.tagsJson) })));
    return { genres, needsReview, unclassified: Math.max(0, tracks - classified) };
  });
}

export interface Health {
  /** Bytes in the file store (every file's size added up), and the limit when ADMIN_BLOB_LIMIT_GB is set. */
  storage: { usedBytes: number; limitBytes: number | null } | null;
  /** Bytes the database holds, and the limit when ADMIN_DB_LIMIT_MB is set. */
  database: { usedBytes: number; limitBytes: number | null } | null;
  /** Jobs waiting or running, by kind, and how many of each failed in the last FAILED_JOB_WINDOW_DAYS days (an old failure is history, not a current problem). */
  queues: { kind: string; waiting: number; running: number; failed: number }[];
  /** Songs the player has not analysed yet (analysis happens the first time a song plays). */
  unanalysed: number | null;
}

/** The file store's total size is kept for this long: listing every file is a request per thousand files, which a page view should not repeat. */
export const BLOB_SIZE_CACHE_MS = 10 * 60 * 1000;
let blobSizeCache: { at: number; bytes: number } | null = null;

/** Forgets the remembered file store size (for the tests). */
export function resetBlobSizeCache() {
  blobSizeCache = null;
}

/** The total size of the file store, listing it a page at a time (a few thousand files is a handful of requests), remembered for ten minutes. */
async function blobBytes(now = Date.now()): Promise<number | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  if (blobSizeCache && now - blobSizeCache.at < BLOB_SIZE_CACHE_MS) return blobSizeCache.bytes;
  const bytes = await listBlobBytes();
  blobSizeCache = { at: now, bytes };
  return bytes;
}

async function listBlobBytes(): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  for (let page = 0; page < 30; page++) {
    const result = await list({ cursor, limit: 1000 });
    total += result.blobs.reduce((sum, b) => sum + b.size, 0);
    if (!result.hasMore) return total;
    cursor = result.cursor;
  }
  return total; // more than 30,000 files: the figure is a floor
}

/** A failed job counts toward the health figure for this many days after it failed. */
export const FAILED_JOB_WINDOW_DAYS = 30;

/** Jobs that failed since `since`: by the time the failure was recorded, else (a job with no finish time) by when it was created. */
const failedSince = (finishedField: "completedAt" | "finishedAt", since: Date) => ({
  status: "failed",
  OR: [{ [finishedField]: { gte: since } }, { [finishedField]: null, createdAt: { gte: since } }],
});

export function loadHealth(now = Date.now()): Promise<Section<Health>> {
  return section(async () => {
    const orNull = async <T>(read: () => Promise<T>): Promise<T | null> => read().catch(() => null);
    const since = new Date(now - FAILED_JOB_WINDOW_DAYS * 86_400_000);
    const [blob, dbRows, genreJobs, stemJobs, genreFailed, stemFailed, unanalysed] = await Promise.all([
      orNull(blobBytes),
      orNull(() => prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`),
      orNull(() => prisma.genreJob.groupBy({ by: ["status"], _count: { _all: true } })),
      orNull(() => prisma.stemSeparationJob.groupBy({ by: ["status"], _count: { _all: true } })),
      orNull(() => prisma.genreJob.count({ where: failedSince("finishedAt", since) })),
      orNull(() => prisma.stemSeparationJob.count({ where: failedSince("completedAt", since) })),
      orNull(() => prisma.track.count({ where: { source: "local", bpm: null } })),
    ]);
    const count = (rows: { status: string; _count: { _all: number } }[] | null, ...statuses: string[]) =>
      rows ? rows.filter((r) => statuses.includes(r.status)).reduce((n, r) => n + r._count._all, 0) : 0;
    const queues: Health["queues"] = [];
    if (genreJobs) queues.push({ kind: "Genre classification", waiting: count(genreJobs, "queued"), running: count(genreJobs, "running"), failed: genreFailed ?? 0 });
    if (stemJobs) queues.push({ kind: "Stem separation", waiting: count(stemJobs, "pending"), running: count(stemJobs, "processing"), failed: stemFailed ?? 0 });
    return {
      storage: blob == null ? null : { usedBytes: blob, limitBytes: limitBytes(process.env.ADMIN_BLOB_LIMIT_GB, 1024 ** 3) },
      database: dbRows?.[0] ? { usedBytes: Number(dbRows[0].bytes), limitBytes: limitBytes(process.env.ADMIN_DB_LIMIT_MB, 1024 ** 2) } : null,
      queues,
      unanalysed,
    };
  });
}

/** Rows for the CSV export of one kind, with their column names. */
export async function exportRows(kind: string, filter: ActivityFilter): Promise<{ columns: string[]; rows: unknown[][] } | null> {
  if (kind === "audit") {
    const r = await loadAuditLog(filter, 5000);
    return r.ok ? { columns: ["when_utc", "event", "role", "device", "target"], rows: r.data.map((x) => [x.at, x.eventType, x.actorRole, x.deviceId ?? "", x.label]) } : null;
  }
  if (kind === "uploads") {
    const r = await loadUploads(filter, 5000);
    return r.ok ? { columns: ["when_utc", "device", "account", "song"], rows: r.data.map((x) => [x.at, x.deviceId ?? "", x.account, x.title]) } : null;
  }
  if (kind === "devices") {
    const r = await loadDevices();
    return r.ok
      ? { columns: ["device", "platform", "os", "app_version", "last_account", "first_seen_utc", "last_seen_utc"], rows: r.data.map((d) => [d.id, d.platform, d.os, d.appVersion, d.account, d.firstSeenAt, d.lastSeenAt]) }
      : null;
  }
  return null;
}
