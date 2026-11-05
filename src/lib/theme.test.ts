import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  migrateThemeState,
  normalizeThemePreference,
  resolveTheme,
  themeInitScript,
  useTheme,
} from "./theme";

afterEach(() => vi.unstubAllGlobals());

describe("defaults", () => {
  it("is dark on a first launch", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("dark");
    expect(normalizeThemePreference(undefined)).toBe("dark");
    expect(useTheme.getState().preference).toBe("dark");
    expect(useTheme.getState().theme).toBe("dark");
  });
});

describe("normalizeThemePreference", () => {
  it("keeps the three real choices and replaces anything else with dark", () => {
    expect(normalizeThemePreference("system")).toBe("system");
    expect(normalizeThemePreference("light")).toBe("light");
    expect(normalizeThemePreference("dark")).toBe("dark");
    expect(normalizeThemePreference("purple")).toBe("dark");
    expect(normalizeThemePreference(null)).toBe("dark");
  });
});

describe("resolveTheme", () => {
  it("shows a fixed choice whatever the device says", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("follows the device for System", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("migrateThemeState", () => {
  it("keeps the light or dark someone had chosen in version 0", () => {
    expect(migrateThemeState({ theme: "light" }, 0)).toEqual({ preference: "light" });
    expect(migrateThemeState({ theme: "dark" }, 0)).toEqual({ preference: "dark" });
  });

  it("reads version 1's preference", () => {
    expect(migrateThemeState({ preference: "system" }, 1)).toEqual({ preference: "system" });
  });

  it("falls back to dark for anything unreadable", () => {
    expect(migrateThemeState(undefined, 0)).toEqual({ preference: "dark" });
    expect(migrateThemeState({ theme: 5 }, 0)).toEqual({ preference: "dark" });
    expect(migrateThemeState({}, 1)).toEqual({ preference: "dark" });
  });
});

function stubDocument() {
  const attrs: Record<string, string> = {};
  const style: { colorScheme?: string } = {};
  const metas = [{ content: THEME_COLORS.dark, setAttribute(name: string, value: string) { if (name === "content") this.content = value; } }];
  vi.stubGlobal("document", {
    documentElement: { setAttribute: (name: string, value: string) => { attrs[name] = value; }, style },
    querySelectorAll: (selector: string) => (selector === 'meta[name="theme-color"]' ? metas : []),
  });
  return { attrs, style, metas };
}

describe("applyThemeToDocument", () => {
  it("sets data-theme, the native color scheme and the browser chrome for dark", () => {
    const { attrs, style, metas } = stubDocument();
    applyThemeToDocument("dark");
    expect(attrs["data-theme"]).toBe("dark");
    expect(style.colorScheme).toBe("dark");
    expect(metas[0].content).toBe(THEME_COLORS.dark);
  });

  it("does the same for light (the attribute is always set, never removed)", () => {
    const { attrs, style, metas } = stubDocument();
    applyThemeToDocument("dark");
    applyThemeToDocument("light");
    expect(attrs["data-theme"]).toBe("light");
    expect(style.colorScheme).toBe("light");
    expect(metas[0].content).toBe(THEME_COLORS.light);
  });

  it("does nothing outside a browser", () => {
    expect(() => applyThemeToDocument("dark")).not.toThrow();
  });
});

describe("the theme store", () => {
  it("setPreference records the choice and what it resolves to", () => {
    useTheme.getState().setPreference("light");
    expect(useTheme.getState().preference).toBe("light");
    expect(useTheme.getState().theme).toBe("light");
    useTheme.getState().setPreference("dark");
  });

  it("toggleTheme flips what is showing and records it as an explicit choice", () => {
    useTheme.getState().setPreference("dark");
    useTheme.getState().toggleTheme();
    expect(useTheme.getState().preference).toBe("light");
    useTheme.getState().toggleTheme();
    expect(useTheme.getState().preference).toBe("dark");
  });

  it("syncTheme re-resolves System against the device", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    useTheme.getState().setPreference("system");
    expect(useTheme.getState().theme).toBe("light");
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    useTheme.getState().syncTheme();
    expect(useTheme.getState().theme).toBe("dark");
    vi.unstubAllGlobals();
    useTheme.getState().setPreference("dark");
  });
});

describe("themeInitScript", () => {
  function run(stored: unknown, systemDark = true) {
    const attrs: Record<string, string> = {};
    const style: { colorScheme?: string } = {};
    const metas = [{ content: "", setAttribute(name: string, value: string) { if (name === "content") this.content = value; } }];
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key === THEME_STORAGE_KEY && stored !== undefined ? JSON.stringify(stored) : null),
    });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: systemDark }) });
    vi.stubGlobal("document", {
      documentElement: { setAttribute: (name: string, value: string) => { attrs[name] = value; }, style },
      querySelectorAll: () => metas,
    });
    new Function(themeInitScript())();
    return { theme: attrs["data-theme"], scheme: style.colorScheme, chrome: metas[0].content };
  }

  it("is dark when nothing is stored, whatever the device says", () => {
    expect(run(undefined, false)).toEqual({ theme: "dark", scheme: "dark", chrome: THEME_COLORS.dark });
  });

  it("applies a stored light choice (version 1)", () => {
    expect(run({ state: { preference: "light" }, version: 1 }).theme).toBe("light");
    expect(run({ state: { preference: "light" }, version: 1 }).chrome).toBe(THEME_COLORS.light);
  });

  it("applies a stored light choice from version 0 too", () => {
    expect(run({ state: { theme: "light" }, version: 0 }).theme).toBe("light");
  });

  it("asks the device for System", () => {
    expect(run({ state: { preference: "system" }, version: 1 }, true).theme).toBe("dark");
    expect(run({ state: { preference: "system" }, version: 1 }, false).theme).toBe("light");
  });

  it("falls back to dark for a stored value it can't read", () => {
    expect(run({ state: { preference: "purple" } }).theme).toBe("dark");
  });
});
