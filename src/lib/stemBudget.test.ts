import { describe, expect, it } from "vitest";
import {
  ASSUMED_JOB_COST_USD,
  DEFAULT_AUTO_BUDGET_USD,
  MAX_AUTO_IN_FLIGHT,
  autoBudgetDecision,
  parseAutoBudgetUsd,
} from "./stemBudget";

describe("autoBudgetDecision", () => {
  it("allows a start with budget to spare and a free slot", () => {
    expect(autoBudgetDecision({ spentUsd: 0.5, inFlight: 0, budgetUsd: 5 })).toEqual({ allowed: true, remainingUsd: 4.5 });
  });

  it("counts in-flight jobs against the budget at the assumed cost", () => {
    const d = autoBudgetDecision({ spentUsd: 1, inFlight: 1, budgetUsd: 5 });
    expect(d.allowed).toBe(true);
    expect(d.remainingUsd).toBeCloseTo(5 - 1 - ASSUMED_JOB_COST_USD, 6);
  });

  it("refuses once spend plus the job about to start would pass the budget", () => {
    const justEnough = autoBudgetDecision({ spentUsd: 5 - ASSUMED_JOB_COST_USD, inFlight: 0, budgetUsd: 5 });
    expect(justEnough.allowed).toBe(true);
    const tooMuch = autoBudgetDecision({ spentUsd: 5 - ASSUMED_JOB_COST_USD + 0.01, inFlight: 0, budgetUsd: 5 });
    expect(tooMuch).toMatchObject({ allowed: false, reason: "budget" });
  });

  it("refuses at the in-flight cap even with plenty of budget", () => {
    const d = autoBudgetDecision({ spentUsd: 0, inFlight: MAX_AUTO_IN_FLIGHT, budgetUsd: 100 });
    expect(d).toMatchObject({ allowed: false, reason: "busy" });
  });

  it("honours a custom in-flight cap", () => {
    expect(autoBudgetDecision({ spentUsd: 0, inFlight: 1, budgetUsd: 100, maxInFlight: 1 })).toMatchObject({ allowed: false, reason: "busy" });
    expect(autoBudgetDecision({ spentUsd: 0, inFlight: 1, budgetUsd: 100, maxInFlight: 3 }).allowed).toBe(true);
  });

  it("never reports a negative remaining budget", () => {
    expect(autoBudgetDecision({ spentUsd: 50, inFlight: 0, budgetUsd: 5 }).remainingUsd).toBe(0);
  });

  it("a zero budget allows nothing", () => {
    expect(autoBudgetDecision({ spentUsd: 0, inFlight: 0, budgetUsd: 0 })).toMatchObject({ allowed: false, reason: "budget" });
  });
});

describe("parseAutoBudgetUsd", () => {
  it("uses the default when unset or blank", () => {
    expect(parseAutoBudgetUsd(undefined)).toBe(DEFAULT_AUTO_BUDGET_USD);
    expect(parseAutoBudgetUsd("")).toBe(DEFAULT_AUTO_BUDGET_USD);
    expect(parseAutoBudgetUsd("  ")).toBe(DEFAULT_AUTO_BUDGET_USD);
  });

  it("reads a sensible number, including zero", () => {
    expect(parseAutoBudgetUsd("12.5")).toBe(12.5);
    expect(parseAutoBudgetUsd("0")).toBe(0);
  });

  it("falls back to the default for junk, negatives and absurd values", () => {
    expect(parseAutoBudgetUsd("abc")).toBe(DEFAULT_AUTO_BUDGET_USD);
    expect(parseAutoBudgetUsd("-3")).toBe(DEFAULT_AUTO_BUDGET_USD);
    expect(parseAutoBudgetUsd("1e9")).toBe(DEFAULT_AUTO_BUDGET_USD);
    expect(parseAutoBudgetUsd("NaN")).toBe(DEFAULT_AUTO_BUDGET_USD);
  });
});
