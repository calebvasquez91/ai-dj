import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  runJobs: vi.fn(),
  topUp: vi.fn(),
  loadFields: vi.fn(),
  prune: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/genre/jobs", () => ({ runJobs: mocks.runJobs }));
vi.mock("@/lib/genre/api", () => ({ loadGenreFields: mocks.loadFields, queueBackfillTopUp: mocks.topUp }));
vi.mock("@/lib/genre/prismaStore", () => ({ genreTablesReady: async () => true, pruneGenreHousekeeping: mocks.prune }));
vi.mock("@/lib/genre/server", () => ({ buildRunnerDeps: () => ({}) }));

import { GET, POST } from "./route";

const summary = (more: boolean) => ({ processed: 3, failed: 0, retrying: 0, more, processedIds: ["a", "b", "c"] });
const withSecret = (method: string, secret = "s3cret") =>
  new Request("http://x/api/genre/run", { method, headers: { authorization: `Bearer ${secret}` } });

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", "s3cret");
  mocks.session = null;
  mocks.runJobs.mockReset().mockResolvedValue(summary(false));
  mocks.topUp.mockReset().mockResolvedValue(7);
  mocks.loadFields.mockReset().mockResolvedValue(new Map());
  mocks.prune.mockReset().mockResolvedValue(undefined);
});

describe("GET /api/genre/run: the scheduled call", () => {
  it("refuses a call without the secret, and with a wrong one, and does no work", async () => {
    expect((await GET(new Request("http://x/api/genre/run"))).status).toBe(401);
    expect((await GET(withSecret("GET", "wrong"))).status).toBe(401);
    expect(mocks.runJobs).not.toHaveBeenCalled();
  });

  it("is refused for everybody when no CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(withSecret("GET", ""))).status).toBe(401);
    expect(mocks.runJobs).not.toHaveBeenCalled();
  });

  it("takes a bigger batch than the app does, inside the function's time limit", async () => {
    await GET(withSecret("GET"));
    const options = mocks.runJobs.mock.calls[0][1];
    expect(options.maxJobs).toBe(20);
    expect(options.budgetMs).toBeLessThan(60_000);
    expect(options.userId).toBeUndefined();
  });

  it("queues the next batch of never-classified songs once the queue has run dry", async () => {
    const res = await GET(withSecret("GET"));
    expect(mocks.topUp).toHaveBeenCalledTimes(1);
    expect((await res.json()).toppedUp).toBe(7);
  });

  it("does not top up while there is still work waiting", async () => {
    mocks.runJobs.mockResolvedValue(summary(true));
    const res = await GET(withSecret("GET"));
    expect(mocks.topUp).not.toHaveBeenCalled();
    expect((await res.json()).toppedUp).toBe(0);
  });
});

describe("POST /api/genre/run: the app's own call", () => {
  it("needs a signed-in person", async () => {
    expect((await POST(new Request("http://x/api/genre/run", { method: "POST" }))).status).toBe(401);
  });

  it("takes a few jobs and never tops up the backfill itself (the app asks for that separately)", async () => {
    mocks.session = { user: { id: "u1" } };
    const res = await POST(new Request("http://x/api/genre/run", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(mocks.runJobs.mock.calls[0][1].maxJobs).toBe(3);
    expect(mocks.topUp).not.toHaveBeenCalled();
  });
});
