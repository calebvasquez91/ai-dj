/**
 * Auto FX settings (on/off plus which effect fires at peaks and at valleys), kept in the browser's localStorage —
 * they're a per-device preference, not library data, so there's no server column for them.
 */

import type { FxSound } from "@/types/music";

/** "none" = do nothing there, "random" = a random Effects sound, anything else = that FX sound's id. */
export type AutoFxChoice = string;

export interface AutoFxSettings {
  enabled: boolean;
  peakFx: AutoFxChoice;
  valleyFx: AutoFxChoice;
}

export const AUTO_FX_DEFAULTS: AutoFxSettings = { enabled: false, peakFx: "random", valleyFx: "random" };
export const AUTO_FX_STORAGE_KEY = "ai-dj:auto-fx";

/**
 * What a saved choice means right now: "none" and "random" as they are, an FX id only while that sound is still in
 * `pool` (the Effects the FX button can play) — a deleted or re-categorised sound falls back to "random", so the
 * dropdown and the audio engine agree on what will actually play.
 */
export function effectiveAutoFxChoice(choice: AutoFxChoice, pool: FxSound[]): AutoFxChoice {
  if (choice === "none" || choice === "random") return choice;
  return pool.some((fx) => fx.id === choice) ? choice : "random";
}

/** Reads saved settings back, falling back field by field to the defaults for anything missing or the wrong type. */
export function parseAutoFxSettings(raw: string | null): AutoFxSettings {
  if (!raw) return AUTO_FX_DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<AutoFxSettings> | null;
    if (!value || typeof value !== "object") return AUTO_FX_DEFAULTS;
    const choice = (v: unknown, fallback: string) => (typeof v === "string" && v.length > 0 && v.length <= 100 ? v : fallback);
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : AUTO_FX_DEFAULTS.enabled,
      peakFx: choice(value.peakFx, AUTO_FX_DEFAULTS.peakFx),
      valleyFx: choice(value.valleyFx, AUTO_FX_DEFAULTS.valleyFx),
    };
  } catch {
    return AUTO_FX_DEFAULTS;
  }
}

/** Browser-only; localStorage can be missing or throw (private windows, blocked storage), so both directions fail soft. */
export function loadAutoFxSettings(): AutoFxSettings {
  try {
    return parseAutoFxSettings(window.localStorage.getItem(AUTO_FX_STORAGE_KEY));
  } catch {
    return AUTO_FX_DEFAULTS;
  }
}

export function saveAutoFxSettings(settings: AutoFxSettings): void {
  try {
    window.localStorage.setItem(AUTO_FX_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // not persisted this time — the setting still applies for the session
  }
}
