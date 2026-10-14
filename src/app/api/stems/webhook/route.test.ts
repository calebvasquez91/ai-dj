import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  advance: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { stemSeparationJob: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/stemJobs", () => ({ advanceStemJob: mocks.advance }));

import { POST } from "./route";

const call = (body: unknown) =>
  POST(new Request("https://app.test/api/stems/webhook", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  mocks.findFirst.mockReset();
  mocks.advance.mockReset();
});

describe("POST /api/stems/webhook", () => {
  it("settles the job that owns the prediction", async () => {
    const job = { id: "j1", trackId: "t1", status: "processing", replicatePredictionId: "pred1", createdAt: new Date() };
    mocks.findFirst.mockResolvedValue(job);
    mocks.advance.mockResolvedValue({ ...job, status: "ready" });
    const res = await call({ id: "pred1", status: "succeeded" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "j1", status: "ready" });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { replicatePredictionId: "pred1" } });
    expect(mocks.advance).toHaveBeenCalledWith(job);
  });

  it("does not trust the payload's status: it only uses the id", async () => {
    mocks.findFirst.mockResolvedValue({ id: "j1", status: "processing", replicatePredictionId: "p", createdAt: new Date() });
    mocks.advance.mockResolvedValue({ id: "j1", status: "processing" });
    await call({ id: "p", status: "succeeded", output: { vocals: "https://evil/x.wav" } });
    const arg = mocks.advance.mock.calls[0][0];
    expect(arg.vocalsUrl).toBeUndefined();
    expect(arg.status).toBe("processing");
  });

  it("answers 404 for an unknown prediction so Replicate retries a webhook that raced the job row", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const res = await call({ id: "nope" });
    expect(res.status).toBe(404);
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it("rejects a body without an id, or one that is not JSON", async () => {
    expect((await call({})).status).toBe(400);
    expect((await call("not json")).status).toBe(400);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("fails with a retryable 5xx when settling throws", async () => {
    mocks.findFirst.mockResolvedValue({ id: "j1", status: "processing", replicatePredictionId: "p", createdAt: new Date() });
    mocks.advance.mockRejectedValue(new Error("blob down"));
    const res = await call({ id: "p" });
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
