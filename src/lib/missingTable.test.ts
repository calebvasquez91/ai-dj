import { describe, expect, it } from "vitest";
import { isMissingTable } from "./missingTable";

describe("isMissingTable", () => {
  it("knows a missing table, a missing column, and a does-not-exist message", () => {
    expect(isMissingTable({ code: "P2021" })).toBe(true);
    expect(isMissingTable({ code: "P2022" })).toBe(true);
    expect(isMissingTable(new Error('relation "Device" does not exist'))).toBe(true);
  });
  it("does not mistake any other error for it", () => {
    expect(isMissingTable({ code: "P2002" })).toBe(false);
    expect(isMissingTable(new Error("connection refused"))).toBe(false);
    expect(isMissingTable(null)).toBe(false);
    expect(isMissingTable(undefined)).toBe(false);
  });
});
