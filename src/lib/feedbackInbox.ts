/**
 * What the owner's feedback inbox shows: a summary (average, how many of each rating, how many lately) and one page of
 * submissions, newest first, optionally only one star rating. Server-only (it reads the database). Plain functions over
 * the real Prisma types, taking the client as a parameter so they can be tested without a database.
 *
 * A page is a view of the list as it stood at a moment (`asOf`), which the links carry from page to page. Without it, a
 * submission arriving while the owner reads would push every item down one place and the next page would repeat the
 * last item of the one before. Anything newer than that moment is counted and offered as a refresh instead.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const INBOX_PAGE_SIZE = 25;
const RECENT_DAYS = 30;

export interface InboxQuery {
  /** 1-based. */
  page: number;
  /** Only this many stars (1-5), or null for all. */
  rating: number | null;
  /** The moment the list is read as of (carried by the paging links), or null for "now". */
  asOf: Date | null;
}

/** Reads `?page=`, `?rating=` and `?asof=` leniently: anything unusable means page 1 / every rating / now. */
export function parseInboxQuery(params: { page?: string | string[]; rating?: string | string[]; asof?: string | string[] }): InboxQuery {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const page = Number(one(params.page));
  const rating = Number(one(params.rating));
  const asOfRaw = one(params.asof);
  const asOf = asOfRaw ? new Date(asOfRaw) : null;
  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    asOf: asOf && Number.isFinite(asOf.getTime()) ? asOf : null,
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
  /** How many there are altogether, as of `asOf`. */
  allTotal: number;
  /** Mean rating over everything as of `asOf`, or null with no feedback yet. */
  average: number | null;
  /** How many of each star rating, as of `asOf`. */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  /** Submissions in the 30 days before `asOf`. */
  recent: number;
  /** Submissions that arrived after `asOf`: not in this view until it is refreshed. */
  newer: number;
  /** The moment this view is as of (ISO): what the paging links carry. */
  asOf: string;
  /** The page actually shown (the one asked for, held to the last page that exists). */
  page: number;
  pageCount: number;
}

export type InboxResult = { ok: true; data: InboxData } | { ok: false; reason: "no-table" | "error" };

const INBOX_SELECT = {
  id: true,
  rating: true,
  comment: true,
  page: true,
  appVersion: true,
  userAgent: true,
  createdAt: true,
  emailedAt: true,
  user: { select: { email: true, name: true } },
} satisfies Prisma.FeedbackSelect;

/** The part of the Prisma client the inbox uses, with its real types: renaming a Feedback column breaks the build here. */
export interface InboxDb {
  feedback: Pick<typeof prisma.feedback, "groupBy" | "count" | "findMany">;
}

/** The error Prisma raises when the table isn't there (it hasn't been created yet: prisma/feedback-table.sql). */
function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2021";
}

export async function loadFeedbackInbox(query: InboxQuery, db: InboxDb = prisma, now: Date = new Date()): Promise<InboxResult> {
  try {
    const asOf = query.asOf && query.asOf.getTime() <= now.getTime() ? query.asOf : now;
    const recentSince = new Date(asOf.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const [grouped, recent, newer] = await Promise.all([
      db.feedback.groupBy({ by: ["rating"], where: { createdAt: { lte: asOf } }, _count: { _all: true } }),
      db.feedback.count({ where: { createdAt: { gte: recentSince, lte: asOf } } }),
      db.feedback.count({ where: { createdAt: { gt: asOf } } }),
    ]);
    const distribution: InboxData["distribution"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of grouped) {
      if (row.rating >= 1 && row.rating <= 5) distribution[row.rating as 1 | 2 | 3 | 4 | 5] = row._count._all;
    }
    const allTotal = Object.values(distribution).reduce((sum, n) => sum + n, 0);
    // The mean follows from how many of each rating there are: no second query needed.
    const average = allTotal === 0 ? null : ([1, 2, 3, 4, 5] as const).reduce((sum, n) => sum + n * distribution[n], 0) / allTotal;
    const total = query.rating === null ? allTotal : distribution[query.rating as 1 | 2 | 3 | 4 | 5];
    const pageCount = Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE));
    const page = Math.min(query.page, pageCount);

    const rows = await db.feedback.findMany({
      where: { createdAt: { lte: asOf }, ...(query.rating === null ? {} : { rating: query.rating }) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * INBOX_PAGE_SIZE,
      take: INBOX_PAGE_SIZE,
      select: INBOX_SELECT,
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
        average,
        distribution,
        recent,
        newer,
        asOf: asOf.toISOString(),
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

/**
 * "Chrome on Windows" from a browser's user-agent string. Approximate by nature: a user-agent says what a browser claims,
 * and many Chromium-based browsers claim to be Chrome; the ones that identify themselves (Samsung Internet, Edge, Opera,
 * Vivaldi, DuckDuckGo, Firefox) are named, and a Mac-looking Safari may be an iPad in desktop mode, so it says so. The
 * full string is on hover in the inbox.
 */
export function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown browser";
  const ua = userAgent;
  const browser = /SamsungBrowser\//.test(ua)
    ? "Samsung Internet"
    : /Edg(?:e|A|iOS)?\//.test(ua)
      ? "Edge"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Vivaldi\//.test(ua)
          ? "Vivaldi"
          : /DuckDuckGo\//.test(ua)
            ? "DuckDuckGo"
            : /UCBrowser\//.test(ua)
              ? "UC Browser"
              : /YaBrowser\//.test(ua)
                ? "Yandex Browser"
                : /Firefox\/|FxiOS\//.test(ua)
                  ? "Firefox"
                  : /Chrome\/|CriOS\//.test(ua)
                    ? "Chrome"
                    : /Safari\//.test(ua)
                      ? "Safari"
                      : null;
  let system = /Windows/.test(ua)
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
  // An iPad asking for the desktop site sends a Mac user-agent, so a Mac-looking Safari can't be told from a real Mac.
  if (system === "macOS" && browser === "Safari") system = "Mac or iPad";
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown browser";
}
