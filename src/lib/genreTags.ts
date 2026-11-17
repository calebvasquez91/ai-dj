/**
 * What a track's genre tags add up to: the summary fields (genre, subgenres) that are derived from them. The pipeline that
 * produces and combines the tags is in src/lib/genre/; this file is only the part the browser also needs.
 */

import type { GenreTag } from "@/types/music";
import { isTaxonomyNode } from "@/lib/genres";

/** A tag below this is kept on the track but is not part of its genre summary. */
export const GENRE_KEEP_CONFIDENCE = 0.5;

export interface GenreSummary {
  /** The highest-confidence genre, or undefined when no tag reaches GENRE_KEEP_CONFIDENCE. */
  genre?: string;
  /** Every genre that reaches the threshold, best first (the summary's genre is the first). */
  genres: string[];
  /** The subgenres of those tags, best first, no duplicates. */
  subgenres: string[];
}

/** Tags worth showing: on the taxonomy and at or above the threshold, best first (ties: the manual one, then the newer). */
export function keptGenreTags(tags: readonly GenreTag[] | undefined, minConfidence = GENRE_KEEP_CONFIDENCE): GenreTag[] {
  if (!tags) return [];
  return tags
    .filter((t) => t.confidence >= minConfidence && isTaxonomyNode(t.genre, t.subgenre))
    .sort((a, b) => b.confidence - a.confidence || Number(b.source === "manual") - Number(a.source === "manual") || b.updatedAt - a.updatedAt);
}

/** genre / genres / subgenres for a track's tags. A track can have several genres; `genre` is its best one. */
export function summarizeGenreTags(tags: readonly GenreTag[] | undefined): GenreSummary {
  const kept = keptGenreTags(tags);
  const genres: string[] = [];
  const subgenres: string[] = [];
  for (const t of kept) {
    if (!genres.includes(t.genre)) genres.push(t.genre);
    if (t.subgenre && !subgenres.includes(t.subgenre)) subgenres.push(t.subgenre);
  }
  return { genre: genres[0], genres, subgenres };
}
