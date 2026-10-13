/**
 * Whether automatic stem separation is switched on, kept in the browser's localStorage (a per-device preference, like
 * Auto FX). OFF by default: turning it on lets the app start paid separation jobs for you.
 */

export interface StemAutoSettings {
  enabled: boolean;
}

export const STEM_AUTO_DEFAULTS: StemAutoSettings = { enabled: false };
export const STEM_AUTO_STORAGE_KEY = "ai-dj:stem-auto";

export function parseStemAutoSettings(raw: string | null): StemAutoSettings {
  if (!raw) return STEM_AUTO_DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<StemAutoSettings> | null;
    if (!value || typeof value !== "object") return STEM_AUTO_DEFAULTS;
    return { enabled: value.enabled === true };
  } catch {
    return STEM_AUTO_DEFAULTS;
  }
}

/** Browser-only; localStorage can be missing or throw, so both directions fail soft. */
export function loadStemAutoSettings(): StemAutoSettings {
  try {
    return parseStemAutoSettings(window.localStorage.getItem(STEM_AUTO_STORAGE_KEY));
  } catch {
    return STEM_AUTO_DEFAULTS;
  }
}

export function saveStemAutoSettings(settings: StemAutoSettings): void {
  try {
    window.localStorage.setItem(STEM_AUTO_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // not persisted this time — the setting still applies for the session
  }
}
