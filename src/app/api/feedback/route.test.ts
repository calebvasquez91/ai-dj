import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "sam@example.com", name: "Sam" } as { id?: string; email?: string; name?: string } | null,
  create: vi.fn(),
  update: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => (mocks.user ? { user: mocks.user } : null)) }));
vi.mock("@/lib/prisma", () => ({ prisma: { feedback: { create: mocks.create, update: mocks.update } } }));
vi.mock("@/lib/mailer", () => ({ sendFeedbackMail: mocks.send }));

import { POST } from "./route";

let n = 0;
function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://x/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "TestBrowser/1.0", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  // A different person per test, so the per-user limit never carries over.
  mocks.user = { id: `u${++n}`, email: "sam@example.com", name: "Sam" };
  mocks.create.mockReset().mockResolvedValue({ id: "f1" });
  mocks.update.mockReset().mockResolvedValue({});
  mocks.send.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/feedback", () => {
  it("needs a signed-in user", async () => {
    mocks.user = null;
    expect((await POST(post({ rating: 5 }))).status).toBe(401);
    mocks.user = { email: "x@y.z" }; // a session with no id
    expect((await POST(post({ rating: 5 }))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects a bad rating, a bad body and an over-long comment before saving or sending anything", async () => {
    for (const body of [{ rating: 0 }, { rating: 6 }, { comment: "no rating" }, "not json", { rating: 3, comment: "x".repeat(2001) }]) {
      expect((await POST(post(body))).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    mocks.user = { id: "fresh-for-413", email: "sam@example.com" }; // the five tries above used this test's quota
    expect((await POST(post({ rating: 3, comment: "x".repeat(9000) }))).status).toBe(413);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("saves the feedback with the person's context, emails the owner and notes that it did", async () => {
    const res = await POST(post({ rating: 4, comment: "  Love it  ", page: "/library" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    const data = mocks.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: mocks.user!.id, rating: 4, comment: "Love it", page: "/library", userAgent: "TestBrowser/1.0" });
    expect(typeof data.appVersion).toBe("string");
    const mail = mocks.send.mock.calls[0][0];
    expect(mail.subject).toContain("4/5");
    expect(mail.text).toContain("Love it");
    expect(mail.text).toContain("Sam <sam@example.com>");
    expect(mail.replyTo).toBe("sam@example.com");
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { emailedAt: expect.any(Date) } });
  });

  it("counts as sent when mail isn't set up: the copy is kept, no email-sent mark", async () => {
    mocks.send.mockResolvedValue(false);
    expect((await POST(post({ rating: 5 }))).status).toBe(201);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("still emails the owner when the copy can't be saved (for instance the table doesn't exist yet)", async () => {
    mocks.create.mockRejectedValue(new Error('relation "Feedback" does not exist'));
    expect((await POST(post({ rating: 2, comment: "ok" }))).status).toBe(201);
    expect(mocks.send).toHaveBeenCalledTimes(1);
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
