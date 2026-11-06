/**
 * Light / dark / system theme preference. Mirrors lib/dj-weights.ts's shape: a small, standalone persisted Zustand store
 * (not merged into the main useStore) since this is purely a local browser preference with no server-side concept.
 *
 * Dark is the default: a first launch (nothing stored) is dark whatever the device says, and "System" is an explicit
 * choice in Settings. The actual switch is a `data-theme="dark" | "light"` attribute on <html> that globals.css keys its
 * tokens off, so this store owns that attribute plus the persisted choice. A blocking inline script in app/layout.tsx
 * (themeInitScript below) sets the same attribute before first paint, reading this store's own localStorage key directly,
 * so there is no flash of the wrong theme while React hydrates.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/** What is showing. */
export type Theme = "light" | "dark";
/** What the user chose: a fixed theme, or "system" to follow the device. */
export type ThemePreference = "system" | "dark" | "light";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "dark", "light"];
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";
export const THEME_STORAGE_KEY = "ai-dj:theme";

/**
 * What the browser's own chrome (Android's address bar, iOS's status area) is tinted: the page background of each theme.
 * Follows the app's choice, not the phone's (the app has its own switch, so the two can disagree and a media query on
 * prefers-color-scheme would show the wrong one).
 */
export const THEME_COLORS: Record<Theme, string> = { light: "#f7f6fb", dark: "#080810" };

/** The stored value if it is one of the three choices, else the default (dark). */
export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "system" || value === "dark" || value === "light" ? value : DEFAULT_THEME_PREFERENCE;
}

/** What a preference shows right now. `systemPrefersDark` is only read for "system". */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * Brings a stored theme state up to date. Version 0 stored `{ theme: "light" | "dark" }`; version 1 stores
 * `{ preference }`. Someone who had chosen light or dark keeps that choice; anything unreadable becomes the default.
 */
export function migrateThemeState(persisted: unknown, version: number): { preference: ThemePreference } {
  const stored = (persisted ?? {}) as { theme?: unknown; preference?: unknown };
  return { preference: normalizeThemePreference(version < 1 ? stored.theme : stored.preference) };
}

/** Whether the device is set to dark. Without matchMedia (tests, very old browsers) the default, dark, wins. */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Sets the data-theme attribute globals.css keys off, the native-control color scheme, and the browser-chrome color. */
export function applyThemeToDocument(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", THEME_COLORS[theme]);
  }
}

/**
 * The blocking script that runs in <head> before first paint. It must agree with the functions above (it is tested
 * against them): the stored choice (version 1's `preference`, or version 0's `theme`) if there is one, otherwise dark;
 * "system" asks the device.
 */
export function themeInitScript(): string {
  return `(function(){try{var p="${DEFAULT_THEME_PREFERENCE}";try{var r=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY
  )});if(r){var s=JSON.parse(r).state||{};var v=s.preference||s.theme;if(v==="light"||v==="system"||v==="dark")p=v;}}catch(e){}var d=p==="dark"||(p==="system"&&(!window.matchMedia||window.matchMedia("(prefers-color-scheme: dark)").matches));var t=d?"dark":"light";var h=document.documentElement;h.setAttribute("data-theme",t);h.style.colorScheme=t;var c=${JSON.stringify(
    THEME_COLORS
  )};var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute("content",c[t]);}catch(e){}})();`;
}

export interface ThemeState {
  preference: ThemePreference;
  /** What the preference shows right now (the device's choice while it is "system"); kept in step by setPreference and syncTheme. */
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
  /** Re-resolves the preference against the device and applies it: once on load, and when the device's setting changes. */
  syncTheme: () => void;
  /** Flips what is showing (the quick switch in the side panel and account menu); this records an explicit light or dark. */
  toggleTheme: () => void;
}

function createThemeState(
  set: (fn: (s: ThemeState) => Partial<ThemeState>) => void,
  get: () => ThemeState
): ThemeState {
  return {
    preference: DEFAULT_THEME_PREFERENCE,
    theme: resolveTheme(DEFAULT_THEME_PREFERENCE, true),
    setPreference: (preference) => {
      const theme = resolveTheme(preference, systemPrefersDark());
      applyThemeToDocument(theme);
      set(() => ({ preference, theme }));
    },
    syncTheme: () => {
      const theme = resolveTheme(get().preference, systemPrefersDark());
      applyThemeToDocument(theme);
      set(() => ({ theme }));
    },
    toggleTheme: () => get().setPreference(get().theme === "dark" ? "light" : "dark"),
  };
}

// Same reasoning as useDjWeights: persist only in a real browser so Vitest/Node environments (no `window`) don't get
// persist's storage-unavailable warning on every write.
export const useTheme =
  typeof window !== "undefined"
    ? create<ThemeState>()(
        persist((set, get) => createThemeState(set, get), {
          name: THEME_STORAGE_KEY,
          version: 1,
          storage: createJSONStorage(() => window.localStorage),
          partialize: (s) => ({ preference: s.preference }),
          migrate: (persisted, version) => migrateThemeState(persisted, version),
        })
      )
    : create<ThemeState>()((set, get) => createThemeState(set, get));
