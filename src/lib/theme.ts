/**
 * Light/dark theme preference. Mirrors lib/dj-weights.ts's shape: a small,
 * standalone persisted Zustand store (not merged into the main useStore)
 * since this is purely a local browser preference with no server-side
 * concept, kept separate so the main store's shape is untouched.
 *
 * The actual switch is a `data-theme="dark"` attribute on <html>, which
 * globals.css keys its dark palette off of — this store just owns that
 * attribute plus the persisted choice. A blocking inline script in
 * app/layout.tsx sets the same attribute before first paint (reading this
 * store's own localStorage key directly) so there's no flash of the wrong
 * theme while React hydrates.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "ai-dj:theme";

export interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

function applyThemeToDocument(theme: Theme) {
  if (typeof document === "undefined") return;
  if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
}

function createThemeState(
  set: (fn: (s: ThemeState) => Partial<ThemeState>) => void
): ThemeState {
  return {
    theme: "light",
    setTheme: (theme) => {
      applyThemeToDocument(theme);
      set(() => ({ theme }));
    },
    toggleTheme: () =>
      set((s) => {
        const next: Theme = s.theme === "dark" ? "light" : "dark";
        applyThemeToDocument(next);
        return { theme: next };
      }),
  };
}

// Same reasoning as useDjWeights: persist only in a real browser so
// Vitest/Node environments (no `window`) don't get persist's storage-
// unavailable warning on every write.
export const useTheme =
  typeof window !== "undefined"
    ? create<ThemeState>()(
        persist((set) => createThemeState(set), {
          name: THEME_STORAGE_KEY,
          storage: createJSONStorage(() => window.localStorage),
        })
      )
    : create<ThemeState>()((set) => createThemeState(set));
