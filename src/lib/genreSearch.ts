/**
 * Search through the genre taxonomy: "trap", "slow jams", "90s r&b", "chill house" find tracks by what they are, not only by
 * the words in their title, artist or tags. The query is read with the same local reader a playlist request uses
 * (curate/spec.ts parseRequestLocally), so the taxonomy's aliases do the work ("rap" is Hip-Hop, "dnb" is Drum & Bass) and moods
 * and decades are understood. Tracks it finds rank after the direct text hits and are never mixed into a query that names
 * no genre, mood or decade. Pure; src/lib/search.ts merges these with its text hits.
 */
import { genreFit } from "@/lib/curate/select";
import { parseRequestLocally, type CurationSpec } from "@/lib/curate/spec";
import type { SearchHit } from "@/lib/search";
import type { Track } from "@/types/music";

/** Genre hits score in this band: above the weakest text matches, below a real title or artist match. */
const BASE = 22;
const SPAN = 12;

/** The part of a query that names a genre, subgenre, mood or decade, or null when it names none. */
export function interpretGenreQuery(query: string): CurationSpec | null {
  if (!query.trim()) return null;
  const { spec } = parseRequestLocally(query);
  const named = spec.genres.length > 0 || spec.subgenres.length > 0 || spec.moods.length > 0 || spec.eraRange != null;
  return named ? spec : null;
}

/** How well a track fits a query's spec for search: null for no, else 0-1. Every named thing must hold; an unknown year or no moods rank lower rather than failing. */
export function genreMatchScore(track: Track, spec: CurationSpec): number | null {
  let score = 0.5;
  if (spec.genres.length > 0 || spec.subgenres.length > 0) {
    // A query that names a subgenre ("trap") wants that subgenre, not every track of its parent genre.
    const best = genreFit(track, spec);
    if (best === 0) return null;
    score = best;
  }
  if (spec.moods.length > 0) {
    const have = track.moods ?? [];
    if (have.length > 0 && !spec.moods.some((m) => have.includes(m))) return null;
    if (have.length === 0) {
      // With a genre named, a track with no mood data is still that genre; with only a mood named there is nothing to go on.
      if (spec.genres.length === 0 && spec.subgenres.length === 0) return null;
      score -= 0.1;
    }
  }
  if (spec.eraRange) {
    if (track.year == null) {
      if (spec.genres.length === 0 && spec.subgenres.length === 0 && spec.moods.length === 0) return null;
      score -= 0.2;
    } else if (track.year < spec.eraRange.from || track.year > spec.eraRange.to) return null;
  }
  return Math.max(0.05, score);
}

/** The tracks a query's genre, mood or decade words pick out, best fit first. Empty when the query names none. */
export function genreHits(tracks: readonly Track[], query: string): SearchHit<Track>[] {
  const spec = interpretGenreQuery(query);
  if (!spec) return [];
  const hits: SearchHit<Track>[] = [];
  tracks.forEach((item, index) => {
    const fit = genreMatchScore(item, spec);
    if (fit != null) hits.push({ item, score: BASE + SPAN * fit, index });
  });
  return hits.sort((a, b) => b.score - a.score || a.index - b.index);
}

/** Text hits first, then the genre hits that are not already among them. */
export function mergeHits(text: readonly SearchHit<Track>[], genre: readonly SearchHit<Track>[]): SearchHit<Track>[] {
  if (genre.length === 0) return [...text];
  const seen = new Set(text.map((h) => h.item.id));
  return [...text, ...genre.filter((h) => !seen.has(h.item.id))];
}
