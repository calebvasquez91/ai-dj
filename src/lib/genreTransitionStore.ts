"use client";

import { create } from "zustand";
import { GENRE_TRANSITIONS_ENABLED } from "@/lib/featureFlags";
import { mergeRules, parseOverrideTable, type OverrideTable, type RuleOverride } from "@/lib/genreTransitionOverrides";
import { GENRE_TRANSITION_DEFAULTS, loadGenreTransitionSettings, saveGenreTransitionSettings, type GenreTransitionSettings } from "@/lib/genreTransitionSettings";
import type { GenreTransitionRule } from "@/lib/genreTransitions";

interface GenreTransitionState {
  settings: GenreTransitionSettings;
  /** The admin's shared edits, as the server last said (empty until fetched, and when the table does not exist yet). */
  shared: OverrideTable;
  /** Whether the shared table's database table exists (so the admin screen can say so). Null until fetched. */
  sharedReady: boolean | null;
  /** Set once this browser's saved settings have been read (they cannot be on the server). */
  loaded: boolean;
  load: () => void;
  loadShared: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  /** Sets this device's override for one genre, or clears it with null. */
  setDeviceOverride: (genre: string, override: RuleOverride | null) => void;
  /** The planner's table: built-in, then shared edits, then this device's. */
  effectiveRules: () => Record<string, GenreTransitionRule>;
}

export const useGenreTransitions = create<GenreTransitionState>((set, get) => ({
  settings: GENRE_TRANSITION_DEFAULTS,
  shared: {},
  sharedReady: null,
  loaded: false,
  load: () => {
    if (get().loaded) return;
    set({ settings: loadGenreTransitionSettings(), loaded: true });
  },
  loadShared: async () => {
    if (!GENRE_TRANSITIONS_ENABLED) return;
    try {
      const res = await fetch("/api/genre-transitions");
      if (!res.ok) return;
      const body = (await res.json()) as { ready?: boolean; overrides?: unknown };
      set({ shared: parseOverrideTable(body.overrides), sharedReady: body.ready === true });
    } catch {
      // offline or signed out: the built-in table and this device's own overrides stand
    }
  },
  setEnabled: (enabled) => {
    const next = { ...get().settings, enabled };
    set({ settings: next });
    saveGenreTransitionSettings(next);
  },
  setDeviceOverride: (genre, override) => {
    const overrides = { ...get().settings.overrides };
    if (override) overrides[genre] = override;
    else delete overrides[genre];
    const next = { ...get().settings, overrides };
    set({ settings: next });
    saveGenreTransitionSettings(next);
  },
  effectiveRules: () => mergeRules(get().shared, get().settings.overrides),
}));
