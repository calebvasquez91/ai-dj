import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "sam@example.com", name: "Sam" } as { id?: string; email?: string; name?: string } | null,
  create: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  findFirst: vi.fn(),
  send: vi.fn(),
  afterTasks: [] as (() => Promise<unknown>)[],
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => (mocks.user ? { user: mocks.user } : null)) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { feedback: { create: mocks.create, update: mocks.update, count: mocks.count, findFirst: mocks.findFirst } },
}));
vi.mock("@/lib/mailer", () => ({ sendFeedbackMail: mocks.send }));
// next/server's after() only works inside a real request; here it just collects the work so a test can run it.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (task: () => Promise<unknown>) => void mocks.afterTasks.push(task) };
});

import { FEEDBACK_MAX_EMAILS_PER_DAY, GET, POST } from "./route";

let n = 0;
function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://x/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "TestBrowser/1.0", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
/** Runs the work the route handed to after(), as the platform does once the response has gone out. */
async function runAfter() {
  while (mocks.afterTasks.length) await mocks.afterTasks.shift()!();
}

beforeEach(() => {
  // A different person per test, so the per-user limit never carries over.
  mocks.user = { id: `u${++n}`, email: "sam@example.com", name: "Sam" };
  mocks.afterTasks.length = 0;
  mocks.create.mockReset().mockResolvedValue({ id: "f1" });
  mocks.update.mockReset().mockResolvedValue({});
  mocks.count.mockReset().mockResolvedValue(0);
  mocks.findFirst.mockReset().mockResolvedValue(null);
  mocks.send.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/feedback", () => {
  it("needs a signed-in user", async () => {
    mocks.user = null;
    expect((await POST(post({ rating: 5 }))).status).toBe(401);
    mocks.user = { email: "x@y.z" }; // a session with no id
    expect((await POST(post({ rating: 5 }))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
    await runAfter();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects a bad rating, a bad body and an over-long comment before saving or sending anything", async () => {
    for (const body of [{ rating: 0 }, { rating: 6 }, { comment: "no rating" }, "not json", { rating: 3, comment: "x".repeat(2001) }]) {
      expect((await POST(post(body))).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    mocks.user = { id: "fresh-for-413", email: "sam@example.com" }; // the five tries above used this test's quota
    expect((await POST(post({ rating: 3, comment: "x".repeat(9000) }))).status).toBe(413);
    expect(mocks.create).not.toHaveBeenCalled();
    await runAfter();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("saves the feedback with the person's context and answers at once; the owner is emailed afterwards", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567890");
    const res = await POST(post({ rating: 4, comment: "  Love it  ", page: "/library" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      userId: mocks.user!.id,
      rating: 4,
      comment: "Love it",
      page: "/library",
      userAgent: "TestBrowser/1.0",
      appVersion: "abcdef1",
    });
    // Nothing has been emailed yet: that work was handed to after().
    expect(mocks.send).not.toHaveBeenCalled();
    await runAfter();
    const mail = mocks.send.mock.calls[0][0];
    expect(mail.subject).toContain("4/5");
    expect(mail.text).toContain("Love it");
    expect(mail.text).toContain("Sam <sam@example.com>");
    expect(mail.text).toContain("App version: abcdef1");
    expect(mail.replyTo).toBe("sam@example.com");
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { emailedAt: expect.any(Date) } });
  });

  it("is not held up by a slow or hanging mail server", async () => {
    mocks.send.mockImplementation(() => new Promise(() => {})); // never settles
    const res = await POST(post({ rating: 5 }));
    expect(res.status).toBe(201);
  });

  it("records 'local' as the version outside a deployment", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    await POST(post({ rating: 5 }));
    expect(mocks.create.mock.calls[0][0].data.appVersion).toBe("local");
  });

  it("counts as sent when mail isn't set up: the copy is kept, no email-sent mark", async () => {
    mocks.send.mockResolvedValue(false);
    expect((await POST(post({ rating: 5 }))).status).toBe(201);
    await runAfter();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("when the copy can't be saved (for instance no table yet) the email is the only record, so it is awaited", async () => {
    mocks.create.mockRejectedValue(new Error('relation "Feedback" does not exist'));
    mocks.count.mockRejectedValue(new Error('relation "Feedback" does not exist'));
    expect((await POST(post({ rating: 2, comment: "ok" }))).status).toBe(201);
    expect(mocks.send).toHaveBeenCalledTimes(1); // sent before the answer, not deferred
    expect(mocks.afterTasks).toHaveLength(0);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("only shows an error when it could neither save nor email", async () => {
    mocks.create.mockRejectedValue(new Error("db down"));
    mocks.send.mockResolvedValue(false);
    const res = await POST(post({ rating: 3 }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/try again/i);
  });

  it("doesn't fail the request when noting the email failed", async () => {
    mocks.update.mockRejectedValue(new Error("db blip"));
    expect((await POST(post({ rating: 5 }))).status).toBe(201);
    await expect(runAfter()).resolves.toBeUndefined();
  });

  it("never lets a failure in the deferred email escape", async () => {
    mocks.send.mockRejectedValue(new Error("boom"));
    expect((await POST(post({ rating: 5 }))).status).toBe(201);
    await expect(runAfter()).resolves.toBeUndefined();
  });

  it("stops emailing once the day's cap is reached, but still keeps the feedback", async () => {
    mocks.count.mockResolvedValue(FEEDBACK_MAX_EMAILS_PER_DAY);
    expect((await POST(post({ rating: 5 }))).status).toBe(201);
    await runAfter();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.count.mockResolvedValue(FEEDBACK_MAX_EMAILS_PER_DAY - 1);
    await POST(post({ rating: 5 }));
    await runAfter();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("limits how often one person can send", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await POST(post({ rating: 5 }))).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429, 429]);
    // Someone else is unaffected.
    mocks.user = { id: "someone-else", email: "o@x.y" };
    expect((await POST(post({ rating: 5 }))).status).toBe(201);
  });

  it("caps a very long user agent", async () => {
    await POST(post({ rating: 5 }, { "user-agent": "x".repeat(900) }));
    expect(mocks.create.mock.calls[0][0].data.userAgent).toHaveLength(300);
  });
});

describe("GET /api/feedback", () => {
  const get = () => GET();

  it("needs a signed-in user", async () => {
    mocks.user = null;
    expect((await get()).status).toBe(401);
    mocks.user = { email: "x@y.z" };
    expect((await get()).status).toBe(401);
  });

  it("says when this account last sent feedback", async () => {
    mocks.findFirst.mockResolvedValue({ createdAt: new Date("2026-11-01T10:00:00Z") });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lastSentAt: "2026-11-01T10:00:00.000Z" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ userId: mocks.user!.id });
  });

  it("says none when nothing was sent, and when the table doesn't exist yet", async () => {
    expect(await (await get()).json()).toEqual({ lastSentAt: null });
    mocks.findFirst.mockRejectedValue(new Error('relation "Feedback" does not exist'));
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lastSentAt: null });
  });
});
