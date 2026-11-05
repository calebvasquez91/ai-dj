import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_COLORS, applyThemeToDocument } from "./theme";

function stubDocument() {
  const attrs: Record<string, string> = {};
  const metas = [{ content: THEME_COLORS.light, setAttribute(name: string, value: string) { if (name === "content") this.content = value; } }];
  vi.stubGlobal("document", {
    documentElement: {
      setAttribute: (name: string, value: string) => { attrs[name] = value; },
      removeAttribute: (name: string) => { delete attrs[name]; },
    },
    querySelectorAll: (selector: string) => (selector === 'meta[name="theme-color"]' ? metas : []),
  });
  return { attrs, metas };
}

afterEach(() => vi.unstubAllGlobals());

describe("applyThemeToDocument", () => {
  it("sets data-theme and tints the browser chrome dark with the app's dark theme", () => {
    const { attrs, metas } = stubDocument();
    applyThemeToDocument("dark");
    expect(attrs["data-theme"]).toBe("dark");
    expect(metas[0].content).toBe(THEME_COLORS.dark);
  });

  it("clears data-theme and returns the browser chrome to the light color", () => {
    const { attrs, metas } = stubDocument();
    applyThemeToDocument("dark");
    applyThemeToDocument("light");
    expect(attrs["data-theme"]).toBeUndefined();
    expect(metas[0].content).toBe(THEME_COLORS.light);
  });

  it("does nothing outside a browser", () => {
    expect(() => applyThemeToDocument("dark")).not.toThrow();
  });
});
