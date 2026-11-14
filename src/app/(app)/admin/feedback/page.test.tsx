import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  owner: null as object | null,
  load: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/feedbackOwner", () => ({ feedbackOwnerSession: vi.fn(async () => mocks.owner) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/FeedbackInboxView", () => ({ FeedbackInboxView: () => null }));
vi.mock("@/lib/feedbackInbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedbackInbox")>()),
  loadFeedbackInbox: mocks.load,
}));

import FeedbackInboxPage from "./page";

const props = (params: Record<string, string> = {}) => ({ searchParams: Promise.resolve(params) });

beforeEach(() => {
  mocks.owner = null;
  mocks.load.mockReset().mockResolvedValue({ ok: false, reason: "no-table" });
  mocks.notFound.mockClear();
});

describe("the feedback inbox page's gate", () => {
  it("shows a 404 to anyone who isn't the owner, and reads nothing from the database first", async () => {
    await expect(FeedbackInboxPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("opens for the owner and loads with what the address asked for", async () => {
    mocks.owner = { user: { id: "cmowner0001" } };
    await FeedbackInboxPage(props({ rating: "2", page: "3", asof: "2026-11-13T12:00:00.000Z" }));
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.load).toHaveBeenCalledTimes(1);
    const query = mocks.load.mock.calls[0][0];
    expect(query).toMatchObject({ rating: 2, page: 3 });
    expect(query.asOf.toISOString()).toBe("2026-11-13T12:00:00.000Z");
  });

  it("says plainly when the table doesn't exist, or the load failed, instead of a blank page", async () => {
    mocks.owner = { user: { id: "cmowner0001" } };
    const noTable = JSON.stringify(await FeedbackInboxPage(props()));
    expect(noTable).toContain("feedback-table.sql");
    mocks.load.mockResolvedValue({ ok: false, reason: "error" });
    expect(JSON.stringify(await FeedbackInboxPage(props()))).toContain("Couldn");
  });
});
