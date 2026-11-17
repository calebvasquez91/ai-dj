/**
 * What a track's genre tags add up to: the summary fields (genre, genres, subgenres) that are derived from them. The tags
 * are combined by src/lib/genre/combine.ts (weighted agreement, a person's own tag winning); this is the shape the rest of
 * the app reads.
 */

import type { GenreTag } from "@/types/music";
import { KEEP_CONFIDENCE, resolveGenreTags } from "@/lib/genre/combine";

/** A genre has to reach this combined confidence to be one of a track's genres. */
export const GENRE_KEEP_CONFIDENCE = KEEP_CONFIDENCE;

export interface GenreSummary {
  /** The highest-confidence genre, or undefined when none reaches GENRE_KEEP_CONFIDENCE. */
  genre?: string;
  /** Every genre that reaches the threshold, best first (the summary's genre is the first). */
  genres: string[];
  /** The subgenres of those genres, best first, no duplicates. */
  subgenres: string[];
}

/** genre / genres / subgenres for a track's tags. A track can have several genres; `genre` is its best one. */
export function summarizeGenreTags(tags: readonly GenreTag[] | undefined): GenreSummary {
  const { genres } = resolveGenreTags(tags);
  const subgenres: string[] = [];
  for (const g of genres) for (const s of g.subgenres) if (!subgenres.includes(s.subgenre)) subgenres.push(s.subgenre);
  return { genre: genres[0]?.genre, genres: genres.map((g) => g.genre), subgenres };
}
