import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { FeedbackInboxView, inboxHref } from "@/components/FeedbackInboxView";
import type { InboxData, InboxItem } from "@/lib/feedbackInbox";

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: "f1",
  rating: 4,
  comment: "Nice",
  page: "/library",
  appVersion: "abc1234",
  userAgent: "UA",
  createdAt: "2026-11-13T12:00:00.000Z",
  emailedAt: null,
  user: { email: "ann@example.com", name: "Ann" },
  ...over,
});

const data = (over: Partial<InboxData> = {}): InboxData => ({
  items: [item()],
  total: 60,
  allTotal: 60,
  distribution: { 1: 5, 2: 10, 3: 15, 4: 20, 5: 10 },
  average: 3.5,
  recent: 12,
  newer: 0,
  page: 2,
  pageCount: 3,
  asOf: "2026-11-13T13:00:00.000Z",
  ...over,
});

const html = (d: InboxData, rating: number | null = null) => renderToStaticMarkup(<FeedbackInboxView data={d} rating={rating} />);

describe("inboxHref", () => {
  it("leaves the defaults out", () => {
    expect(inboxHref(1, null)).toBe("/admin/feedback");
    expect(inboxHref(1, 3)).toBe("/admin/feedback?rating=3");
    expect(inboxHref(2, null)).toBe("/admin/feedback?page=2");
  });
  it("carries the as-of time only when given, encoded", () => {
    expect(inboxHref(2, 3, "2026-11-13T13:00:00.000Z")).toBe("/admin/feedback?rating=3&page=2&asof=2026-11-13T13%3A00%3A00.000Z");
    expect(inboxHref(1, null, "2026-11-13T13:00:00.000Z")).toBe("/admin/feedback?asof=2026-11-13T13%3A00%3A00.000Z");
  });
});

describe("FeedbackInboxView", () => {
  it("links Reply for an ordinary address", () => {
    expect(html(data())).toContain('href="mailto:ann@example.com?subject=');
  });

  it("shows an address that could inject mail fields as plain text, with no Reply link", () => {
    const out = html(data({ items: [item({ user: { email: "a@b.co?bcc=evil@x.com", name: null } })] }));
    expect(out).toContain("a@b.co?bcc=evil@x.com");
    expect(out).not.toContain("mailto:");
    expect(out).not.toContain(">Reply<");
  });

  it("marks the selected filter with aria-current and no other", () => {
    const out = html(data(), 4);
    expect(out.match(/aria-current="true"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-current="true"[^>]*>4 ★</);
    expect(html(data(), null)).toMatch(/aria-current="true"[^>]*>All</);
  });

  it("offers to show new arrivals, and says nothing when there are none", () => {
    expect(html(data({ newer: 3 }))).toContain("3 new since you opened this.");
    expect(html(data({ newer: 1 }))).toContain("Show it");
    expect(html(data({ newer: 0 }))).not.toContain("new since you opened this");
  });

  it("carries the as-of time on the paging links, but not on the filters or the rating bars", () => {
    const out = html(data({ page: 2 }), 4);
    expect(out).toContain('href="/admin/feedback?rating=4&amp;asof=2026-11-13T13%3A00%3A00.000Z"'); // Newer -> page 1
    expect(out).toContain('href="/admin/feedback?rating=4&amp;page=3&amp;asof=2026-11-13T13%3A00%3A00.000Z"'); // Older
    const hrefs = [...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    const withAsOf = hrefs.filter((h) => h.includes("asof="));
    expect(withAsOf).toHaveLength(2);
    expect(hrefs).toContain("/admin/feedback?rating=5"); // a filter: starts fresh
  });

  it("has a Delete control on each submission", () => {
    expect(html(data({ items: [item({ id: "a" }), item({ id: "b" })] })).match(/>Delete</g)).toHaveLength(2);
  });

  it("says so when there is nothing to show", () => {
    expect(html(data({ items: [], total: 0, allTotal: 0, average: null, page: 1, pageCount: 1, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }))).toContain("No feedback yet");
  });
});
