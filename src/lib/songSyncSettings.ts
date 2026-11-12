/**
 * Whether Song Sync Mode's "Auto" switch is on, and whether transition sounds are used between songs, kept in the browser's localStorage (a per-device preference, like Auto
 * FX and automatic stems). ON by default: the morph is how tracks change. Someone who switched it off has that saved
 * and keeps it off, and the ordinary transitions take over the automatic mixes.
 */

export interface SongSyncSettings {
  auto: boolean;
  /** Carry the change between two songs with a sound from the FX library (the song morphs onto it, it plays for about thirty seconds, then it morphs onto the next song). Only acts while Auto is on. */
  transitionSounds: boolean;
}

export const SONG_SYNC_DEFAULTS: SongSyncSettings = { auto: true, transitionSounds: true };
export const SONG_SYNC_STORAGE_KEY = "ai-dj:song-sync";

export function parseSongSyncSettings(raw: string | null): SongSyncSettings {
  if (!raw) return SONG_SYNC_DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<SongSyncSettings> | null;
    if (!value || typeof value !== "object") return SONG_SYNC_DEFAULTS;
    return {
      auto: typeof value.auto === "boolean" ? value.auto : SONG_SYNC_DEFAULTS.auto,
      transitionSounds:
        typeof value.transitionSounds === "boolean" ? value.transitionSounds : SONG_SYNC_DEFAULTS.transitionSounds,
    };
  } catch {
    return SONG_SYNC_DEFAULTS;
  }
}

/** Browser-only; localStorage can be missing or throw, so both directions fail soft. */
export function loadSongSyncSettings(): SongSyncSettings {
  try {
    return parseSongSyncSettings(window.localStorage.getItem(SONG_SYNC_STORAGE_KEY));
  } catch {
    return SONG_SYNC_DEFAULTS;
  }
}

export function saveSongSyncSettings(settings: SongSyncSettings): void {
  try {
    window.localStorage.setItem(SONG_SYNC_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // not persisted this time — the setting still applies for the session
  }
}
