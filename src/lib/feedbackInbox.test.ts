import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INBOX_PAGE_SIZE,
  barPercent,
  describeUserAgent,
  formatAverage,
  loadFeedbackInbox,
  parseInboxQuery,
  type InboxDb,
} from "@/lib/feedbackInbox";

afterEach(() => vi.restoreAllMocks());

describe("parseInboxQuery", () => {
  it("reads a page and a rating", () => {
    expect(parseInboxQuery({ page: "3", rating: "2" })).toEqual({ page: 3, rating: 2 });
  });
  it("falls back to page 1 and every rating for anything unusable", () => {
    for (const params of [{}, { page: "0", rating: "0" }, { page: "-2", rating: "6" }, { page: "abc", rating: "x" }, { page: "1.5", rating: "2.5" }, { page: "", rating: "" }]) {
      expect(parseInboxQuery(params), JSON.stringify(params)).toEqual({ page: 1, rating: null });
    }
  });
  it("takes the first of a repeated parameter", () => {
    expect(parseInboxQuery({ page: ["2", "9"], rating: ["5", "1"] })).toEqual({ page: 2, rating: 5 });
  });
});

/** A fake database holding `n` feedback rows, newest first, with the given ratings (cycling). */
function fakeDb(n: number, ratings = [5, 4, 3, 2, 1]) {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    rating: ratings[i % ratings.length],
    comment: `comment ${i}`,
    page: "/library",
    appVersion: "abc1234",
    userAgent: "UA",
    createdAt: new Date(Date.UTC(2026, 10, 13, 12, 0, 0) - i * 60_000),
    emailedAt: i % 2 === 0 ? new Date(Date.UTC(2026, 10, 13, 12, 0, 5) - i * 60_000) : null,
    user: { email: `u${i}@example.com`, name: i % 3 === 0 ? null : `User ${i}` },
  }));
  const findMany = vi.fn(async (args: { where: { rating?: number }; skip: number; take: number }) =>
    rows.filter((r) => args.where.rating === undefined || r.rating === args.where.rating).slice(args.skip, args.skip + args.take)
  );
  const db = {
    feedback: {
      groupBy: vi.fn(async () => [1, 2, 3, 4, 5].map((rating) => ({ rating, _count: { _all: rows.filter((r) => r.rating === rating).length } })).filter((g) => g._count._all > 0)),
      aggregate: vi.fn(async () => ({ _avg: { rating: rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : null } })),
      count: vi.fn(async (args: { where: { createdAt: { gte: Date } } }) => rows.filter((r) => r.createdAt >= args.where.createdAt.gte).length),
      findMany,
    },
  };
  return { db: db as unknown as InboxDb, findMany };
}

describe("loadFeedbackInbox", () => {
  const now = new Date(Date.UTC(2026, 10, 13, 13, 0, 0));

  it("summarises everything: the average, the count of each rating, the total and the recent count", async () => {
    const { db } = fakeDb(10);
    const result = await loadFeedbackInbox({ page: 1, rating: null }, db, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.allTotal).toBe(10);
    expect(result.data.total).toBe(10);
    expect(result.data.distribution).toEqual({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 });
    expect(result.data.average).toBe(3);
    expect(result.data.recent).toBe(10);
    expect(result.data.page).toBe(1);
    expect(result.data.pageCount).toBe(1);
  });

  it("returns the newest first, with times as ISO strings and the sender's details", async () => {
    const { db } = fakeDb(3);
    const result = await loadFeedbackInbox({ page: 1, rating: null }, db, now);
    if (!result.ok) throw new Error("expected data");
    const [first] = result.data.items;
    expect(first).toEqual({
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

  it("filters by rating, and counts the matches for the paging", async () => {
    const { db, findMany } = fakeDb(10);
    const result = await loadFeedbackInbox({ page: 1, rating: 3 }, db, now);
    if (!result.ok) throw new Error("expected data");
    expect(result.data.items.every((i) => i.rating === 3)).toBe(true);
    expect(result.data.total).toBe(2);
    expect(result.data.allTotal).toBe(10);
    expect((findMany.mock.calls[0][0] as { where: unknown }).where).toEqual({ rating: 3 });
  });

  it("pages, and holds an out-of-range page to the last one", async () => {
    const { db, findMany } = fakeDb(INBOX_PAGE_SIZE * 2 + 3);
    const second = await loadFeedbackInbox({ page: 2, rating: null }, db, now);
    if (!second.ok) throw new Error("expected data");
    expect(second.data.pageCount).toBe(3);
    expect(second.data.items).toHaveLength(INBOX_PAGE_SIZE);
    expect(second.data.items[0].id).toBe(`f${INBOX_PAGE_SIZE}`);
    const beyond = await loadFeedbackInbox({ page: 99, rating: null }, db, now);
    if (!beyond.ok) throw new Error("expected data");
    expect(beyond.data.page).toBe(3);
    expect(beyond.data.items).toHaveLength(3);
    expect(findMany.mock.calls.at(-1)?.[0]).toMatchObject({ skip: INBOX_PAGE_SIZE * 2, take: INBOX_PAGE_SIZE });
  });

  it("handles no feedback at all", async () => {
    const { db } = fakeDb(0);
    const result = await loadFeedbackInbox({ page: 1, rating: null }, db, now);
    if (!result.ok) throw new Error("expected data");
    expect(result.data).toMatchObject({ items: [], total: 0, allTotal: 0, average: null, recent: 0, page: 1, pageCount: 1 });
    expect(result.data.distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it("counts only the last 30 days as recent", async () => {
    const { db } = fakeDb(5);
    const later = new Date(Date.UTC(2026, 11, 20, 0, 0, 0)); // more than 30 days after every row
    const result = await loadFeedbackInbox({ page: 1, rating: null }, db, later);
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
          aggregate: async () => ({ _avg: { rating: null } }),
          count: async () => 0,
          findMany: async () => [],
        },
      }) as unknown as InboxDb;
    expect(await loadFeedbackInbox({ page: 1, rating: null }, failing(missing), now)).toEqual({ ok: false, reason: "no-table" });
    expect(await loadFeedbackInbox({ page: 1, rating: null }, failing(new Error("connection reset")), now)).toEqual({ ok: false, reason: "error" });
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
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")).toBe("Safari on macOS");
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iOS");
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(describeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe("Firefox on Linux");
  });
  it("copes with a partial or missing string", () => {
    expect(describeUserAgent(null)).toBe("Unknown browser");
    expect(describeUserAgent("")).toBe("Unknown browser");
    expect(describeUserAgent("curl/8.0")).toBe("Unknown browser");
    expect(describeUserAgent("SomeApp (Windows)")).toBe("Windows");
  });
});
