import { describe, expect, it } from "vitest";
import { formatTotalDuration } from "./format";

describe("formatTotalDuration", () => {
  it("is minutes under an hour, rounded up", () => {
    expect(formatTotalDuration(45 * 60)).toBe("45 min");
    expect(formatTotalDuration(61)).toBe("2 min");
    expect(formatTotalDuration(1)).toBe("1 min");
  });

  it("adds hours from sixty minutes", () => {
    expect(formatTotalDuration(3725)).toBe("1 hr 3 min");
    expect(formatTotalDuration(7200)).toBe("2 hr");
  });

  it("is 0 min for none or a bad number", () => {
    expect(formatTotalDuration(0)).toBe("0 min");
    expect(formatTotalDuration(Number.NaN)).toBe("0 min");
    expect(formatTotalDuration(-5)).toBe("0 min");
  });
});
