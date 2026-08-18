import type { Track } from "@/types/music";

export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Shuffle order for Shuffle Play: Do-Not-Play tracks are excluded entirely,
 * Must-Play tracks are guaranteed inclusion at the front (still shuffled
 * among themselves). This only governs *automatic* selection — a direct
 * manual click on a Do-Not-Play track still plays it, since curation flags
 * should never block an explicit request.
 */
export function shuffleForPlay(tracks: Track[]): Track[] {
  const eligible = tracks.filter((t) => t.playPreference !== "do-not");
  const must = eligible.filter((t) => t.playPreference === "must");
  const rest = eligible.filter((t) => t.playPreference !== "must");
  return [...shuffle(must), ...shuffle(rest)];
}
