import { describe, expect, it } from "vitest";
import { SWIPE_MIN_PX, moveTab, swipeDelta } from "./tabSwipe";

describe("swipeDelta", () => {
  it("goes forward on a swipe left and back on a swipe right", () => {
    expect(swipeDelta(-120, 5)).toBe(1);
    expect(swipeDelta(120, -5)).toBe(-1);
  });

  it("ignores a short drag", () => {
    expect(swipeDelta(SWIPE_MIN_PX - 1, 0)).toBe(0);
    expect(swipeDelta(SWIPE_MIN_PX, 0)).toBe(-1);
  });

  it("ignores a drag that is mostly vertical (a scroll)", () => {
    expect(swipeDelta(80, 200)).toBe(0);
    expect(swipeDelta(-80, -120)).toBe(0);
  });

  it("ignores bad numbers", () => {
    expect(swipeDelta(Number.NaN, 0)).toBe(0);
  });
});

describe("moveTab", () => {
  const tabs = ["queue", "dj", "chat"] as const;

  it("steps along the tabs", () => {
    expect(moveTab(tabs, "queue", 1)).toBe("dj");
    expect(moveTab(tabs, "chat", -1)).toBe("dj");
  });

  it("stops at the ends", () => {
    expect(moveTab(tabs, "queue", -1)).toBe("queue");
    expect(moveTab(tabs, "chat", 1)).toBe("chat");
  });

  it("leaves an unknown tab alone", () => {
    expect(moveTab(tabs, "nope" as "queue", 1)).toBe("nope");
  });
});
