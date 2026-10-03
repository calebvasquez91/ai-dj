/**
 * Playlist-affinity tags that make an FX sound eligible for Spooky Music.
 * While that playlist is active, transition FX and ambient loops are chosen
 * only from FX carrying one of these (see store.requestAiFxPick and
 * DualDeckStage's ambientLoopPool), so uploads meant for it must carry them.
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
