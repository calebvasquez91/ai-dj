import type { FxSound } from "@/types/music";

/**
 * Playlist-affinity tags that make an FX sound a Halloween sound, which may play only in Spooky Music.
 * Uploads meant for it must carry them. Which sounds are eligible where is decided in one place, getEligibleFX below.
 */
export const HALLOWEEN_AFFINITY = ["spooky", "halloween"];

/** True when an FX already carries a tag Spooky Music will accept (the store checks for either one). */
export function hasHalloweenAffinity(affinity: string[]): boolean {
  return affinity.some((tag) => HALLOWEEN_AFFINITY.includes(tag.toLowerCase()));
}

/** The affinity list with the Halloween tags added, keeping whatever else was already there. */
export function withHalloweenAffinity(affinity: string[]): string[] {
  const lower = affinity.map((tag) => tag.toLowerCase());
  return [...affinity, ...HALLOWEEN_AFFINITY.filter((tag) => !lower.includes(tag))];
}

/**
 * A Halloween sound: tagged "halloween", or with a "halloween"/"spooky" playlist affinity (any case). Halloween sounds
 * may only be loaded or played while Spooky Music is the active playlist.
 */
export function isHalloweenFx(fx: Pick<FxSound, "tags" | "playlistAffinity">): boolean {
  return fx.tags.some((tag) => tag.toLowerCase() === "halloween") || hasHalloweenAffinity(fx.playlistAffinity);
}

/**
 * THE rule for which FX sounds may be used, in one place. In Spooky Music only Halloween sounds are eligible; in every
 * other playlist (or with nothing playing) Halloween sounds are excluded entirely and everything else stays eligible.
 * Every path that selects, previews, auto-triggers, lists in a picker, or sends FX to Claude filters through this
 * first — never the raw library.
 */
export function getEligibleFX(library: FxSound[], spookyActive: boolean): FxSound[] {
  return library.filter((fx) => isHalloweenFx(fx) === spookyActive);
}
