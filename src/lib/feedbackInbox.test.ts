import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INBOX_PAGE_SIZE,
  barPercent,
  describeUserAgent,
  formatAverage,
  loadFeedbackInbox,
  parseInboxQuery,
  type InboxDb,
  type InboxQuery,
} from "@/lib/feedbackInbox";

afterEach(() => vi.restoreAllMocks());

const query = (over: Partial<InboxQuery> = {}): InboxQuery => ({ page: 1, rating: null, asOf: null, ...over });

describe("parseInboxQuery", () => {
  it("reads a page, a rating and an as-of time", () => {
    const q = parseInboxQuery({ page: "3", rating: "2", asof: "2026-11-13T12:00:00.000Z" });
    expect(q).toMatchObject({ page: 3, rating: 2 });
    expect(q.asOf?.toISOString()).toBe("2026-11-13T12:00:00.000Z");
  });
  it("falls back to page 1, every rating and now for anything unusable", () => {
    for (const params of [{}, { page: "0", rating: "0" }, { page: "-2", rating: "6" }, { page: "abc", rating: "x" }, { page: "1.5", rating: "2.5" }, { page: "", rating: "", asof: "" }, { asof: "not a date" }]) {
      expect(parseInboxQuery(params), JSON.stringify(params)).toEqual({ page: 1, rating: null, asOf: null });
    }
  });
  it("takes the first of a repeated parameter", () => {
    expect(parseInboxQuery({ page: ["2", "9"], rating: ["5", "1"] })).toMatchObject({ page: 2, rating: 5 });
  });
});

interface Row {
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

/** A fake database holding `n` feedback rows, newest first, with the given ratings (cycling), answering the way Prisma would. */
function fakeDb(n: number, ratings = [5, 4, 3, 2, 1], newest = Date.UTC(2026, 10, 13, 12, 0, 0)) {
  const rows: Row[] = Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    rating: ratings[i % ratings.length],
    comment: `comment ${i}`,
    page: "/library",
    appVersion: "abc1234",
    userAgent: "UA",
    createdAt: new Date(newest - i * 60_000),
    emailedAt: i % 2 === 0 ? new Date(Date.UTC(2026, 10, 13, 12, 0, 5) - i * 60_000) : null,
    user: { email: `u${i}@example.com`, name: i % 3 === 0 ? null : `User ${i}` },
  }));
  type Where = { createdAt?: { gte?: Date; lte?: Date; gt?: Date }; rating?: number };
  const matches = (r: Row, w: Where) =>
    (w.rating === undefined || r.rating === w.rating) &&
    (!w.createdAt?.gte || r.createdAt >= w.createdAt.gte) &&
    (!w.createdAt?.lte || r.createdAt <= w.createdAt.lte) &&
    (!w.createdAt?.gt || r.createdAt > w.createdAt.gt);
  const findMany = vi.fn(async (args: { where: Where; skip: number; take: number }) => rows.filter((r) => matches(r, args.where)).slice(args.skip, args.skip + args.take));
  const groupBy = vi.fn(async (args: { where: Where }) =>
    [1, 2, 3, 4, 5].map((rating) => ({ rating, _count: { _all: rows.filter((r) => r.rating === rating && matches(r, args.where)).length } })).filter((g) => g._count._all > 0)
  );
  const count = vi.fn(async (args: { where: Where }) => rows.filter((r) => matches(r, args.where)).length);
  return { db: { feedback: { groupBy, count, findMany } } as unknown as InboxDb, findMany, groupBy, count };
}

describe("loadFeedbackInbox", () => {
  const now = new Date(Date.UTC(2026, 10, 13, 13, 0, 0));

  it("summarises everything: the average, the count of each rating, the total and the recent count", async () => {
    const { db } = fakeDb(10);
    const result = await loadFeedbackInbox(query(), db, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.allTotal).toBe(10);
    expect(result.data.total).toBe(10);
    expect(result.data.distribution).toEqual({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 });
    expect(result.data.average).toBe(3);
    expect(result.data.recent).toBe(10);
    expect(result.data.newer).toBe(0);
    expect(result.data.page).toBe(1);
    expect(result.data.pageCount).toBe(1);
    expect(result.data.asOf).toBe(now.toISOString());
  });

  it("works the average out from how many of each rating there are, without a query of its own", async () => {
    const { db, groupBy, count, findMany } = fakeDb(3, [5, 5, 2]); // 5, 5, 2 -> 4.0
    const result = await loadFeedbackInbox(query(), db, now);
    if (!result.ok) throw new Error("expected data");
    expect(result.data.average).toBe(4);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledTimes(2); // recent and newer
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(Object.keys(db.feedback)).not.toContain("aggregate");
  });

  it("returns the newest first, with times as ISO strings and the sender's details", async () => {
    const { db } = fakeDb(3);
    const result = await loadFeedbackInbox(query(), db, now);
    if (!result.ok) throw new Error("expected data");
    expect(result.data.items[0]).toEqual({
      id: "f0",
      rating: 5,
      comment: "comment 0",
      page: "/library",
      appVersion: "abc1234",
      userAgent: "UA",
      createdAt: "2026-11-13T12:00:00.000Z",
      emailedAt: "2026-11-13T12:00:05.000Z",
      user: { email: "u0@example.com", name: null },
    });
    expect(result.data.items[1].emailedAt).toBeNull();
  });

  it("orders by time and then id, so equal times keep a stable order across pages", async () => {
    const { db, findMany } = fakeDb(2);
    await loadFeedbackInbox(query(), db, now);
    expect((findMany.mock.calls[0][0] as { orderBy?: unknown }).orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("filters by rating, and counts the matches for the paging", async () => {
    const { db, findMany } = fakeDb(10);
    const result = await loadFeedbackInbox(query({ rating: 3 }), db, now);
    if (!result.ok) throw new Error("expected data");
    expect(result.data.items.every((i) => i.rating === 3)).toBe(true);
    expect(result.data.total).toBe(2);
    expect(result.data.allTotal).toBe(10);
    expect((findMany.mock.calls[0][0] as { where: { rating?: number } }).where.rating).toBe(3);
  });

  it("pages, and holds an out-of-range page to the last one", async () => {
    const { db, findMany } = fakeDb(INBOX_PAGE_SIZE * 2 + 3);
    const second = await loadFeedbackInbox(query({ page: 2 }), db, now);
    if (!second.ok) throw new Error("expected data");
    expect(second.data.pageCount).toBe(3);
    expect(second.data.items).toHaveLength(INBOX_PAGE_SIZE);
    expect(second.data.items[0].id).toBe(`f${INBOX_PAGE_SIZE}`);
    const beyond = await loadFeedbackInbox(query({ page: 99 }), db, now);
    if (!beyond.ok) throw new Error("expected data");
    expect(beyond.data.page).toBe(3);
    expect(beyond.data.items).toHaveLength(3);
    expect(findMany.mock.calls.at(-1)?.[0]).toMatchObject({ skip: INBOX_PAGE_SIZE * 2, take: INBOX_PAGE_SIZE });
  });

  it("holds still while it is read: a submission arriving after the as-of time is not in the view, and is counted instead", async () => {
    const { db } = fakeDb(60);
    const asOf = new Date(Date.UTC(2026, 10, 13, 11, 40, 0)); // rows f20.. are at or before this
    const result = await loadFeedbackInbox(query({ asOf }), db, now);
    if (!result.ok) throw new Error("expected data");
    expect(result.data.asOf).toBe(asOf.toISOString());
    expect(result.data.allTotal).toBe(40);
    expect(result.data.newer).toBe(20);
    expect(result.data.items[0].id).toBe("f20");
    expect(result.data.items.every((i) => new Date(i.createdAt) <= asOf)).toBe(true);
  });

  it("two page loads with the same as-of time neither repeat nor skip an item, even when new feedback arrives between them", async () => {
    const asOf = new Date(Date.UTC(2026, 10, 13, 12, 0, 0)); // the list as it stood when page 1 opened
    const before = fakeDb(60);
    const page1 = await loadFeedbackInbox(query({ page: 1, asOf }), before.db, now);
    // 5 new submissions arrive (all newer than asOf) before the owner clicks Older: every old row is pushed down 5 places.
    const after = fakeDb(65, undefined, asOf.getTime() + 5 * 60_000);
    const page2 = await loadFeedbackInbox(query({ page: 2, asOf }), after.db, now);
    if (!page1.ok || !page2.ok) throw new Error("expected data");
    expect(page2.data.newer).toBe(5);
    expect(page2.data.allTotal).toBe(60);
    const times = [...page1.data.items, ...page2.data.items].map((i) => new Date(i.createdAt).getTime());
    expect(times).toHaveLength(INBOX_PAGE_SIZE * 2);
    times.forEach((t, i) => expect(t).toBe(asOf.getTime() - i * 60_000)); // one unbroken run, newest to oldest
  });

  it("ignores an as-of time in the future", async () => {
    const { db } = fakeDb(3);
    const result = await loadFeedbackInbox(query({ asOf: new Date(now.getTime() + 86_400_000) }), db, now);
    if (!result.ok) throw new Error("expected data");
    expect(result.data.asOf).toBe(now.toISOString());
  });

  it("handles no feedback at all", async () => {
    const { db } = fakeDb(0);
    const result = await loadFeedbackInbox(query(), db, now);
    if (!result.ok) throw new Error("expected data");
    expect(result.data).toMatchObject({ items: [], total: 0, allTotal: 0, average: null, recent: 0, newer: 0, page: 1, pageCount: 1 });
    expect(result.data.distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it("counts only the last 30 days before the as-of time as recent", async () => {
    const { db } = fakeDb(5);
    const later = new Date(Date.UTC(2026, 11, 20, 0, 0, 0)); // more than 30 days after every row
    const result = await loadFeedbackInbox(query({ asOf: later }), db, new Date(later.getTime() + 1000));
    if (!result.ok) throw new Error("expected data");
    expect(result.data.recent).toBe(0);
    expect(result.data.allTotal).toBe(5);
  });

  it("says so when the table doesn't exist yet, and when anything else goes wrong (without throwing)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const missing = Object.assign(new Error("The table `public.Feedback` does not exist"), { code: "P2021" });
    const failing = (error: Error) =>
      ({
        feedback: {
          groupBy: async () => Promise.reject(error),
          count: async () => 0,
          findMany: async () => [],
        },
      }) as unknown as InboxDb;
    expect(await loadFeedbackInbox(query(), failing(missing), now)).toEqual({ ok: false, reason: "no-table" });
    expect(await loadFeedbackInbox(query(), failing(new Error("connection reset")), now)).toEqual({ ok: false, reason: "error" });
  });
});

describe("formatAverage / barPercent", () => {
  it("rounds to one decimal, with a dash for no ratings", () => {
    expect(formatAverage(4.26)).toBe("4.3");
    expect(formatAverage(3)).toBe("3.0");
    expect(formatAverage(null)).toBe("—");
  });
  it("scales a count against the biggest bucket", () => {
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(10, 10)).toBe(100);
    expect(barPercent(0, 10)).toBe(0);
    expect(barPercent(3, 0)).toBe(0);
  });
});

describe("describeUserAgent", () => {
  it("names the browser and the system", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0")).toBe("Edge on Windows");
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iOS");
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(describeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe("Firefox on Linux");
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")).toBe("Chrome on macOS");
  });
  it("names the browsers that identify themselves instead of calling them Chrome", () => {
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Safari/537.36")).toBe("Samsung Internet on Android");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0")).toBe("Opera on Windows");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Vivaldi/6.9")).toBe("Vivaldi on Windows");
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 DuckDuckGo/7")).toBe("DuckDuckGo on iOS");
  });
  it("won't say a Mac-looking Safari is definitely a Mac (an iPad in desktop mode sends the same string)", () => {
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")).toBe("Safari on Mac or iPad");
  });
  it("copes with a partial or missing string", () => {
    expect(describeUserAgent(null)).toBe("Unknown browser");
    expect(describeUserAgent("")).toBe("Unknown browser");
    expect(describeUserAgent("curl/8.0")).toBe("Unknown browser");
    expect(describeUserAgent("SomeApp (Windows)")).toBe("Windows");
  });
});
