import { describe, expect, it } from "vitest";
import { sidebarShowing, toggledSidebarChoice } from "./viewport";

describe("sidebarShowing", () => {
  it("follows the viewport until the user chooses", () => {
    expect(sidebarShowing(null, true)).toBe(true);
    expect(sidebarShowing(null, false)).toBe(false);
  });

  it("lets an explicit choice win on either viewport", () => {
    expect(sidebarShowing(false, true)).toBe(false);
    expect(sidebarShowing(true, false)).toBe(true);
  });
});

describe("toggledSidebarChoice", () => {
  it("collapses the panel that desktop opens by default, and remembers it", () => {
    expect(toggledSidebarChoice(null, true)).toBe(false);
  });

  it("opens the drawer a phone keeps closed by default, and remembers it", () => {
    expect(toggledSidebarChoice(null, false)).toBe(true);
  });

  it("records no choice when it returns to the viewport's own default", () => {
    // closing the drawer on a phone, reopening the collapsed panel on desktop
    expect(toggledSidebarChoice(true, false)).toBeNull();
    expect(toggledSidebarChoice(false, true)).toBeNull();
  });

  it("follows what is showing when a choice made on the other layout is still stored", () => {
    // collapsed on desktop, then the window narrowed: the drawer is closed, so the hamburger opens it
    expect(toggledSidebarChoice(false, false)).toBe(true);
    // opened as a phone drawer, then the window widened: the panel is showing, so the hamburger collapses it
    expect(toggledSidebarChoice(true, true)).toBe(false);
  });
});
