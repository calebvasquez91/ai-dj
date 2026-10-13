import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  predict: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/prisma", () => {
  const stemSeparationJob = {
    findFirst: mocks.findFirst,
    findMany: mocks.findMany,
    create: mocks.create,
    update: mocks.update,
  };
  const tx = { $executeRaw: vi.fn(async () => 1), stemSeparationJob };
  return {
    prisma: {
      track: { findUnique: vi.fn(async () => ({ id: "t1", userId: "u1", source: "local", storageKey: "k", sourceUrl: "https://x/a.mp3" })) },
      stemSeparationJob,
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/lib/storage", () => ({ getStorageBackend: () => "blob", uploadBlobFile: vi.fn(async () => "https://blob/x") }));
vi.mock("@/lib/trackApi", () => ({ trackSourceUrl: () => "https://x/a.mp3" }));
vi.mock("replicate", () => ({
  default: class {
    predictions = { create: mocks.predict, get: mocks.get, cancel: mocks.cancel };
  },
}));

import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ id: "t1" }) };
const post = (auto: boolean) =>
  POST(new Request(`http://localhost/api/tracks/t1/stems${auto ? "?auto=1" : ""}`, { method: "POST" }), ctx as never);

const recent = () => new Date(Date.now() - 60_000);

beforeEach(() => {
  process.env.REPLICATE_API_TOKEN = "test-token";
  process.env.STEM_AUTO_BUDGET_USD = "5";
  mocks.findFirst.mockReset().mockResolvedValue(null);
  mocks.findMany.mockReset().mockResolvedValue([]);
  mocks.create.mockReset().mockImplementation(async () => ({ id: "j1", status: "pending", createdAt: new Date() }));
  mocks.update.mockReset().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "j1", ...data }));
  mocks.predict.mockReset().mockResolvedValue({ id: "pred1", version: "v1" });
  mocks.get.mockReset();
  mocks.cancel.mockReset().mockResolvedValue({});
});

describe("POST /api/tracks/[id]/stems â€” automatic starts", () => {
  it("starts a job when there is budget and a free slot", async () => {
    const res = await post(true);
    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.predict).toHaveBeenCalledTimes(1);
  });

  it("refuses with 402 and starts nothing once the budget is spent", async () => {
    mocks.findMany.mockResolvedValue([{ status: "ready", estimatedCostUsd: 4.95, createdAt: new Date(0) }]);
    const res = await post(true);
    expect(res.status).toBe(402);
    expect((await res.json()).reason).toBe("budget");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.predict).not.toHaveBeenCalled();
  });

  it("refuses with 429 when too many jobs are already running", async () => {
    mocks.findMany.mockResolvedValue([
      { status: "processing", estimatedCostUsd: null, createdAt: recent() },
      { status: "processing", estimatedCostUsd: null, createdAt: recent() },
    ]);
    const res = await post(true);
    expect(res.status).toBe(429);
    expect((await res.json()).reason).toBe("busy");
    expect(mocks.predict).not.toHaveBeenCalled();
  });

  it("never retries a failed job by itself: returns it and starts nothing", async () => {
    mocks.findFirst.mockResolvedValue({ id: "j0", status: "failed", createdAt: new Date(0), errorMessage: "boom" });
    const res = await post(true);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("failed");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.predict).not.toHaveBeenCalled();
  });

  it("returns an existing running job as-is without a budget check", async () => {
    mocks.findFirst.mockResolvedValue({ id: "j0", status: "processing", createdAt: recent() });
    mocks.findMany.mockResolvedValue([{ status: "ready", estimatedCostUsd: 99, createdAt: new Date(0) }]); // way over budget
    const res = await post(true);
    expect(res.status).toBe(200);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/tracks/[id]/stems - when this server can't separate", () => {
  it("answers 503 with a clear reason, and records no failed job, when the Replicate token is missing", async () => {
    delete process.env.REPLICATE_API_TOKEN;
    const res = await post(false);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "replicate", error: expect.stringMatching(/REPLICATE_API_TOKEN/) });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.predict).not.toHaveBeenCalled();
  });
});

describe("POST /api/tracks/[id]/stems â€” manual starts (unchanged)", () => {
  it("is not held to the automatic budget", async () => {
    mocks.findMany.mockResolvedValue([{ status: "ready", estimatedCostUsd: 99, createdAt: new Date(0) }]);
    const res = await post(false);
    expect(res.status).toBe(201);
    expect(mocks.predict).toHaveBeenCalledTimes(1);
  });

  it("still retries a failed job when someone presses the button", async () => {
    mocks.findFirst.mockResolvedValue({ id: "j0", status: "failed", createdAt: new Date(0) });
    const res = await post(false);
    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.predict).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/tracks/[id]/stems — webhook", () => {
  it("asks Replicate to call back when it runs on an https deployment", async () => {
    await POST(new Request("https://ai-dj-gamma.vercel.app/api/tracks/t1/stems", { method: "POST" }), ctx as never);
    const input = mocks.predict.mock.calls[0][0];
    expect(input.webhook).toBe("https://ai-dj-gamma.vercel.app/api/stems/webhook");
    expect(input.webhook_events_filter).toEqual(["completed"]);
  });

  it("registers no webhook on localhost (polling is the only path there)", async () => {
    await post(false);
    expect(mocks.predict.mock.calls[0][0].webhook).toBeUndefined();
  });
});

describe("GET /api/tracks/[id]/stems — settling", () => {
  const get = () => GET(new Request("http://localhost/api/tracks/t1/stems"), ctx as never);
  const running = { id: "j1", trackId: "t1", status: "processing", replicatePredictionId: "pred1", createdAt: new Date(Date.now() - 60_000) };

  it("says an uncollected run expired instead of 'unexpected output shape'", async () => {
    mocks.findFirst.mockResolvedValue({ ...running, createdAt: new Date(Date.now() - 3 * 3600_000) });
    mocks.get.mockResolvedValue({
      status: "succeeded",
      output: null,
      completed_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
      metrics: {},
    });
    const res = await get();
    const job = await res.json();
    expect(job.status).toBe("failed");
    expect(job.errorMessage).toMatch(/weren't collected in time/);
  });

  it("gives up on a run stuck past the time limit and cancels it", async () => {
    mocks.findFirst.mockResolvedValue({ ...running, createdAt: new Date(Date.now() - 40 * 60_000) });
    mocks.get.mockResolvedValue({ status: "processing", output: null, metrics: {} });
    const job = await (await get()).json();
    expect(job.status).toBe("failed");
    expect(job.errorMessage).toMatch(/Gave up/);
    expect(mocks.cancel).toHaveBeenCalledWith("pred1");
  });

  it("leaves a run that is still within the time limit alone", async () => {
    mocks.findFirst.mockResolvedValue(running);
    mocks.get.mockResolvedValue({ status: "processing", output: null, metrics: {} });
    const job = await (await get()).json();
    expect(job.status).toBe("processing");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("answers 502 when Replicate can't be reached", async () => {
    mocks.findFirst.mockResolvedValue(running);
    mocks.get.mockRejectedValue(new Error("network"));
    expect((await get()).status).toBe(502);
  });
});
