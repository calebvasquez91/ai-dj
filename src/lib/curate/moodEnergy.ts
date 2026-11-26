/**
 * What energy a request's moods ask for, and a rough energy for a song from the facts nearly every song has (its tempo when it is known, else its genre). The curator
 * uses it to prefer songs that fit the energy a mood implies ("pump up" wants high energy, "rainy day" low), and the song-list suggestions use the same table with the
 * list's own energy. A plain heuristic, not a measurement. Pure.
 */
import { GENRE_PRIOR, bpmEnergy } from "@/lib/curate/energyArc";

/**
 * The energy (0-1) a mood asks for, for the moods that clearly imply one. Moods that say nothing about energy (nostalgic, romantic, road-trip...) are not here.
 */
export const MOOD_ENERGY: Readonly<Record<string, number>> = { workout: 0.85, energetic: 0.85, aggressive: 0.85, party: 0.8, chill: 0.3, sad: 0.3, dreamy: 0.35, dinner: 0.35, focus: 0.4, sleep: 0.15 };
/** A song whose energy is further than this from what the request's moods ask for is left out of the song-list suggestions; nearer, the miss lowers its score by ENERGY_WEIGHT times the miss. */
export const ENERGY_MISS_LIMIT = 0.4;
export const ENERGY_WEIGHT = 0.6;

/** The energy the request's moods ask for: the average of those that imply one, or null when none does. */
export function moodEnergyTarget(moods: readonly string[]): number | null {
  const targets = moods.map((m) => MOOD_ENERGY[m]).filter((t): t is number => t != null);
  return targets.length > 0 ? targets.reduce((s, t) => s + t, 0) / targets.length : null;
}

/** A rough 0-1 energy for a song with no measured loudness: from its tempo when that is known (70 BPM is slow, 180 fast), else the prior for its genre; null when it has neither. */
export function proxyEnergy(bpm: number | null | undefined, genre: string | null | undefined): number | null {
  if (bpm != null && bpm > 0) return bpmEnergy(bpm);
  const prior = genre ? GENRE_PRIOR[genre] : undefined;
  return prior ?? null;
}
