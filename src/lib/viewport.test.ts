import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESKTOP_MIN_WIDTH, TABLET_MIN_WIDTH, layoutForWidth, sidebarShowing, toggledSidebarChoice } from "./viewport";

describe("layoutForWidth", () => {
  it("is a phone below 600", () => {
    expect(layoutForWidth(320)).toBe("phone");
    expect(layoutForWidth(599)).toBe("phone");
  });

  it("is a tablet from 600 to 1023", () => {
    expect(layoutForWidth(600)).toBe("tablet");
    expect(layoutForWidth(768)).toBe("tablet");
    expect(layoutForWidth(1023)).toBe("tablet");
  });

  it("is a desktop from 1024", () => {
    expect(layoutForWidth(1024)).toBe("desktop");
    expect(layoutForWidth(1920)).toBe("desktop");
  });
});

describe("the breakpoints", () => {
  it("are the same numbers the tablet: and desktop: classes use in globals.css", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css.match(/--breakpoint-tablet:\s*(\d+)px/)?.[1]).toBe(String(TABLET_MIN_WIDTH));
    expect(css.match(/--breakpoint-desktop:\s*(\d+)px/)?.[1]).toBe(String(DESKTOP_MIN_WIDTH));
  });
});

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
