import { describe, expect, it } from "vitest";
import { PULL_MAX_PX, PULL_THRESHOLD_PX, pullOffset, shouldRefresh } from "./pullToRefresh";

describe("pullOffset", () => {
  it("follows the drag at half speed", () => {
    expect(pullOffset(60)).toBe(30);
  });

  it("stops at the maximum", () => {
    expect(pullOffset(1000)).toBe(PULL_MAX_PX);
  });

  it("is 0 for no drag, an upward drag or a bad number", () => {
    expect(pullOffset(0)).toBe(0);
    expect(pullOffset(-20)).toBe(0);
    expect(pullOffset(Number.NaN)).toBe(0);
  });
});

describe("shouldRefresh", () => {
  it("refreshes once the drag has gone far enough", () => {
    expect(shouldRefresh(pullOffset(PULL_THRESHOLD_PX))).toBe(true);
  });

  it("does not refresh for a short pull", () => {
    expect(shouldRefresh(pullOffset(PULL_THRESHOLD_PX - 20))).toBe(false);
    expect(shouldRefresh(0)).toBe(false);
  });
});
