/**
 * Instrumental mode: a device setting that plays a song's vocal-free mix instead of the full song, for songs whose instrumental has been built
 * (lib/stemInstrumental.ts). Only ever active while VOCAL_SPLIT_ENABLED is on; a song with no instrumental plays as it always does. With the flag off this
 * returns the song's own URL untouched, so the player behaves exactly as before. The setting takes effect from the next song to load.
 */
import { VOCAL_SPLIT_ENABLED } from "@/lib/featureFlags";

export const INSTRUMENTAL_MODE_STORAGE_KEY = "ai-dj:instrumental-mode";

export interface InstrumentalState {
  instrumentalMode: boolean;
  /** trackId -> the URL of its built instrumental. Only songs whose separation has finished are in here. */
  instrumentalAvailability: Record<string, string>;
}

/** The URL a deck should play (or decode) for this song: its instrumental when the mode is on and one exists, else the song itself. */
export function playbackUrl(track: { id: string; sourceUrl: string }, state: InstrumentalState): string {
  if (!VOCAL_SPLIT_ENABLED || !state.instrumentalMode) return track.sourceUrl;
  return state.instrumentalAvailability[track.id] ?? track.sourceUrl;
}

/** Browser-only; storage can be missing or throw, so both directions fail soft. */
export function loadInstrumentalMode(): boolean {
  try {
    return window.localStorage.getItem(INSTRUMENTAL_MODE_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveInstrumentalMode(on: boolean): void {
  try {
    window.localStorage.setItem(INSTRUMENTAL_MODE_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // private mode or full storage: the setting just does not persist
  }
}
