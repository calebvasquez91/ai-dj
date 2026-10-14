import { afterEach, describe, expect, it } from "vitest";
import { stemSummaryForUser, type StemJobDb } from "./stemSummary";

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const minutesAgo = (m: number) => new Date(NOW - m * 60_000);

function db(jobs: { status: string; estimatedCostUsd: number | null; createdAt: Date }[]): StemJobDb {
  return { stemSeparationJob: { findMany: async () => jobs } };
}

const ENV = process.env.STEM_AUTO_BUDGET_USD;
afterEach(() => {
  if (ENV === undefined) delete process.env.STEM_AUTO_BUDGET_USD;
  else process.env.STEM_AUTO_BUDGET_USD = ENV;
});

describe("stemSummaryForUser", () => {
  it("sums recorded cost and counts ready, failed and in-flight jobs", async () => {
    const s = await stemSummaryForUser(
      db([
        { status: "ready", estimatedCostUsd: 0.04, createdAt: minutesAgo(500) },
        { status: "ready", estimatedCostUsd: 0.06, createdAt: minutesAgo(400) },
        { status: "failed", estimatedCostUsd: null, createdAt: minutesAgo(300) },
        { status: "processing", estimatedCostUsd: null, createdAt: minutesAgo(3) },
        { status: "pending", estimatedCostUsd: null, createdAt: minutesAgo(1) },
      ]),
      "u1",
      NOW
    );
    expect(s.spentUsd).toBeCloseTo(0.1, 6);
    expect(s).toMatchObject({ ready: 2, failed: 1, inFlight: 2 });
  });

  it("does not count an old pending/processing job as running", async () => {
    const s = await stemSummaryForUser(db([{ status: "processing", estimatedCostUsd: null, createdAt: minutesAgo(120) }]), "u1", NOW);
    expect(s.inFlight).toBe(0);
  });

  it("is all zeros for a user with no jobs", async () => {
    expect(await stemSummaryForUser(db([]), "u1", NOW)).toMatchObject({ spentUsd: 0, inFlight: 0, ready: 0, failed: 0 });
  });

  it("reads the budget from STEM_AUTO_BUDGET_USD, with a default", async () => {
    delete process.env.STEM_AUTO_BUDGET_USD;
    expect((await stemSummaryForUser(db([]), "u1", NOW)).budgetUsd).toBe(5);
    process.env.STEM_AUTO_BUDGET_USD = "20";
    expect((await stemSummaryForUser(db([]), "u1", NOW)).budgetUsd).toBe(20);
  });
});
