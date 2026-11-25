// What the person has chosen for genre-aware transitions on this device: the on/off switch (off by default until the feature is verified) and their own
// per-genre overrides. Kept in this browser like the other DJ preferences. The switch does nothing while GENRE_TRANSITIONS_ENABLED
// (lib/featureFlags.ts) is off. Pure parsing here; the browser store is lib/genreTransitionStore.ts.
import { parseOverrideTable, type OverrideTable } from "@/lib/genreTransitionOverrides";

export interface GenreTransitionSettings {
  enabled: boolean;
  /** This device's own overrides; the admin's shared edits are separate and apply to every device. */
  overrides: OverrideTable;
}

export const GENRE_TRANSITION_DEFAULTS: GenreTransitionSettings = { enabled: false, overrides: {} };

export const GENRE_TRANSITION_STORAGE_KEY = "ai-dj:genre-transitions";

export function parseGenreTransitionSettings(raw: string | null | undefined): GenreTransitionSettings {
  if (!raw) return GENRE_TRANSITION_DEFAULTS;
  try {
    const v = JSON.parse(raw) as { enabled?: unknown; overrides?: unknown } | null;
    if (!v || typeof v !== "object") return GENRE_TRANSITION_DEFAULTS;
    return { enabled: v.enabled === true, overrides: parseOverrideTable(v.overrides) };
  } catch {
    return GENRE_TRANSITION_DEFAULTS;
  }
}

/** Browser-only; storage can be missing or throw, so both directions fail soft. */
export function loadGenreTransitionSettings(): GenreTransitionSettings {
  try {
    return parseGenreTransitionSettings(window.localStorage.getItem(GENRE_TRANSITION_STORAGE_KEY));
  } catch {
    return GENRE_TRANSITION_DEFAULTS;
  }
}

export function saveGenreTransitionSettings(settings: GenreTransitionSettings): void {
  try {
    window.localStorage.setItem(GENRE_TRANSITION_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // private mode or full storage: the setting just does not persist
  }
}
