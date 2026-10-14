import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ backend: "blob" as "blob" | "local" }));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    stemSeparationJob: {
      findMany: vi.fn(async () => [{ status: "ready", estimatedCostUsd: 0.05, createdAt: new Date(0) }]),
    },
  },
}));
vi.mock("@/lib/storage", () => ({ getStorageBackend: () => state.backend }));

import { GET } from "./route";

const ENV = process.env.REPLICATE_API_TOKEN;
beforeEach(() => {
  state.backend = "blob";
  process.env.REPLICATE_API_TOKEN = "t";
});
afterEach(() => {
  if (ENV === undefined) delete process.env.REPLICATE_API_TOKEN;
  else process.env.REPLICATE_API_TOKEN = ENV;
});

describe("GET /api/stems/summary", () => {
  it("reports the counts and that stems are available", async () => {
    const body = await (await GET()).json();
    expect(body).toMatchObject({ ready: 1, support: { available: true } });
  });

  it("says plainly that the local storage backend can't make stems", async () => {
    state.backend = "local";
    const body = await (await GET()).json();
    expect(body.support).toMatchObject({ available: false, reason: "storage" });
  });
});
