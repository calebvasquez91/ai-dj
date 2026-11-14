/**
 * What the owner's feedback inbox shows: a summary (average, how many of each rating, how many lately) and one page of
 * submissions, newest first, optionally only one star rating. Server-only (it reads the database). Plain functions over
 * a small database interface, so it can be tested without one.
 */
import { prisma } from "@/lib/prisma";

export const INBOX_PAGE_SIZE = 25;
const RECENT_DAYS = 30;

export interface InboxQuery {
  /** 1-based. */
  page: number;
  /** Only this many stars (1-5), or null for all. */
  rating: number | null;
}

/** Reads `?page=` and `?rating=` leniently: anything unusable means page 1 / every rating. */
export function parseInboxQuery(params: { page?: string | string[]; rating?: string | string[] }): InboxQuery {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const page = Number(one(params.page));
  const rating = Number(one(params.rating));
  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
  };
}

export interface InboxItem {
  id: string;
  rating: number;
  comment: string;
  page: string | null;
  appVersion: string | null;
  userAgent: string | null;
  /** ISO times (a Date can't cross to a client component). */
  createdAt: string;
  emailedAt: string | null;
  user: { email: string; name: string | null };
}

export interface InboxData {
  items: InboxItem[];
  /** How many submissions match the rating filter. */
  total: number;
  /** How many there are altogether. */
  allTotal: number;
  /** Mean rating over everything, or null with no feedback yet. */
  average: number | null;
  /** How many of each star rating, over everything. */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  /** Submissions in the last 30 days. */
  recent: number;
  /** The page actually shown (the one asked for, held to the last page that exists). */
  page: number;
  pageCount: number;
}

export type InboxResult = { ok: true; data: InboxData } | { ok: false; reason: "no-table" | "error" };

interface InboxRow {
  id: string;
  rating: number;
  comment: string;
  page: string | null;
  appVersion: string | null;
  userAgent: string | null;
  createdAt: Date;
  emailedAt: Date | null;
  user: { email: string; name: string | null };
}

/** The part of the Prisma client the inbox uses. */
export interface InboxDb {
  feedback: {
    groupBy(args: { by: ["rating"]; _count: { _all: true } }): Promise<{ rating: number; _count: { _all: number } }[]>;
    aggregate(args: { _avg: { rating: true } }): Promise<{ _avg: { rating: number | null } }>;
    count(args: { where: { createdAt: { gte: Date } } }): Promise<number>;
    findMany(args: {
      where: { rating?: number };
      orderBy: { createdAt: "desc" };
      skip: number;
      take: number;
      select: Record<string, unknown>;
    }): Promise<InboxRow[]>;
  };
}

/** The error Prisma raises when the table isn't there (it hasn't been created yet: prisma/feedback-table.sql). */
function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2021";
}

export async function loadFeedbackInbox(query: InboxQuery, db: InboxDb = prisma as unknown as InboxDb, now: Date = new Date()): Promise<InboxResult> {
  try {
    const [grouped, avg, recent] = await Promise.all([
      db.feedback.groupBy({ by: ["rating"], _count: { _all: true } }),
      db.feedback.aggregate({ _avg: { rating: true } }),
      db.feedback.count({ where: { createdAt: { gte: new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000) } } }),
    ]);
    const distribution: InboxData["distribution"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of grouped) {
      if (row.rating >= 1 && row.rating <= 5) distribution[row.rating as 1 | 2 | 3 | 4 | 5] = row._count._all;
    }
    const allTotal = Object.values(distribution).reduce((sum, n) => sum + n, 0);
    const total = query.rating === null ? allTotal : distribution[query.rating as 1 | 2 | 3 | 4 | 5];
    const pageCount = Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE));
    const page = Math.min(query.page, pageCount);

    const rows = await db.feedback.findMany({
      where: query.rating === null ? {} : { rating: query.rating },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * INBOX_PAGE_SIZE,
      take: INBOX_PAGE_SIZE,
      select: {
        id: true,
        rating: true,
        comment: true,
        page: true,
        appVersion: true,
        userAgent: true,
        createdAt: true,
        emailedAt: true,
        user: { select: { email: true, name: true } },
      },
    });

    return {
      ok: true,
      data: {
        items: rows.map((row) => ({
          id: row.id,
          rating: row.rating,
          comment: row.comment,
          page: row.page,
          appVersion: row.appVersion,
          userAgent: row.userAgent,
          createdAt: row.createdAt.toISOString(),
          emailedAt: row.emailedAt ? row.emailedAt.toISOString() : null,
          user: { email: row.user.email, name: row.user.name },
        })),
        total,
        allTotal,
        average: avg._avg.rating,
        distribution,
        recent,
        page,
        pageCount,
      },
    };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "no-table" };
    console.error("[feedback inbox] could not load:", err);
    return { ok: false, reason: "error" };
  }
}

/** "4.3", or "—" with no ratings. */
export function formatAverage(average: number | null): string {
  return average === null ? "—" : (Math.round(average * 10) / 10).toFixed(1);
}

/** A rating's share of the biggest bucket, 0-100, for the bar beside it. */
export function barPercent(count: number, max: number): number {
  return max > 0 ? Math.round((count / max) * 100) : 0;
}

/** "Chrome on Windows" from a browser's user-agent string; the browser alone, or the system alone, or "Unknown browser". */
export function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown browser";
  const ua = userAgent;
  const browser = /Edg(?:e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const system = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown browser";
}
