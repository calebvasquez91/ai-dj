import { describe, expect, it } from "vitest";
import { keyboardInset } from "./useKeyboardInset";

describe("keyboardInset", () => {
  it("is 0 with no keyboard (the visual viewport fills the layout one)", () => {
    expect(keyboardInset(800, { height: 800, offsetTop: 0, scale: 1 })).toBe(0);
  });

  it("is the height the keyboard covers", () => {
    expect(keyboardInset(800, { height: 500, offsetTop: 0, scale: 1 })).toBe(300);
  });

  it("subtracts how far the visual viewport has scrolled down", () => {
    expect(keyboardInset(800, { height: 500, offsetTop: 120, scale: 1 })).toBe(180);
  });

  it("is never negative", () => {
    expect(keyboardInset(800, { height: 820, offsetTop: 0, scale: 1 })).toBe(0);
  });

  it("is 0 when the page is only pinch-zoomed in", () => {
    expect(keyboardInset(800, { height: 400, offsetTop: 0, scale: 2 })).toBe(0);
  });
});
