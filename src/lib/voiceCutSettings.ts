/**
 * Whether a song moves on when its voices have stopped (lib/voiceMap.ts), kept in the browser's localStorage. On by
 * default; it only ever acts on tracks that have voice data, and the cut-off is the engineer's call per track.
 */

export interface VoiceCutSettings {
  enabled: boolean;
}

export const VOICE_CUT_DEFAULTS: VoiceCutSettings = { enabled: true };
export const VOICE_CUT_STORAGE_KEY = "ai-dj:voice-cut";

/** Only an explicit `false` turns it off: a missing or damaged value keeps the default (on). */
export function parseVoiceCutSettings(raw: string | null): VoiceCutSettings {
  if (!raw) return VOICE_CUT_DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<VoiceCutSettings> | null;
    if (!value || typeof value !== "object") return VOICE_CUT_DEFAULTS;
    return { enabled: value.enabled !== false };
  } catch {
    return VOICE_CUT_DEFAULTS;
  }
}

export function loadVoiceCutSettings(): VoiceCutSettings {
  try {
    return parseVoiceCutSettings(window.localStorage.getItem(VOICE_CUT_STORAGE_KEY));
  } catch {
    return VOICE_CUT_DEFAULTS;
  }
}

export function saveVoiceCutSettings(settings: VoiceCutSettings): void {
  try {
    window.localStorage.setItem(VOICE_CUT_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // not persisted this time — the setting still applies for the session
  }
}
