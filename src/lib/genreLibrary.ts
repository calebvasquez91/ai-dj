/**
 * The library by genre, for the Genres view, the genre filter and the review screen. Pure: the screens only lay it out.
 * A track counts under every genre it has (it can have several), resolved the same way the server resolves it
 * (src/lib/genre/combine.ts), so a person's own genres decide it.
 */
import { resolveGenreTags, type ResolvedGenre } from "@/lib/genre/combine";
import { suggestionsFrom } from "@/lib/genre/stored";
import type { GenreTag, GenreTagSource, Track } from "@/types/music";

/** The words a person sees for each source. */
export const SOURCE_LABELS: Readonly<Record<GenreTagSource, string>> = {
  "file-tags": "File tags",
  musicbrainz: "MusicBrainz",
  lastfm: "Last.fm",
  "audio-classifier": "Audio model",
  llm: "AI DJ's guess",
  manual: "You",
};

/** The genres a track has, best first, with their subgenres. Empty for a track nobody has classified. */
export function genresOfTrack(track: Pick<Track, "genreTags" | "genre" | "subgenres">): ResolvedGenre[] {
  const resolved = resolveGenreTags(track.genreTags).genres;
  if (resolved.length > 0 || !track.genre) return resolved;
  // A summary without tags (an older record): show what it says.
  return [{ genre: track.genre, confidence: 0.5, subgenres: (track.subgenres ?? []).map((subgenre) => ({ subgenre, confidence: 0.5 })), sources: [] }];
}

export interface GenreCount {
  genre: string;
  count: number;
  subgenres: { subgenre: string; count: number }[];
}

export interface GenreOverview {
  /** Genres with at least one track, most tracks first (ties A to Z). */
  genres: GenreCount[];
  /** Tracks with no genre (not classified yet, or nothing was sure enough). */
  unclassified: number;
  /** Tracks waiting for a person to look at their genre. */
  needsReview: number;
}

export function genreOverview(tracks: readonly Track[]): GenreOverview {
  const byGenre = new Map<string, { count: number; subs: Map<string, number> }>();
  let unclassified = 0;
  let needsReview = 0;
  for (const track of tracks) {
    if (track.genreStatus === "needs-review") needsReview++;
    const genres = genresOfTrack(track);
    if (genres.length === 0) {
      unclassified++;
      continue;
    }
    for (const g of genres) {
      const entry = byGenre.get(g.genre) ?? { count: 0, subs: new Map<string, number>() };
      entry.count++;
      for (const s of g.subgenres) entry.subs.set(s.subgenre, (entry.subs.get(s.subgenre) ?? 0) + 1);
      byGenre.set(g.genre, entry);
    }
  }
  const genres = [...byGenre.entries()]
    .map(([genre, e]) => ({
      genre,
      count: e.count,
      subgenres: [...e.subs.entries()].map(([subgenre, count]) => ({ subgenre, count })).sort((a, b) => b.count - a.count || a.subgenre.localeCompare(b.subgenre)),
    }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
  return { genres, unclassified, needsReview };
}

export interface GenreFilter {
  genre: string;
  subgenre?: string;
}

/** The tracks that have the genre (and the subgenre, if one is given). */
export function filterByGenre(tracks: readonly Track[], filter: GenreFilter): Track[] {
  return tracks.filter((t) => genresOfTrack(t).some((g) => g.genre === filter.genre && (!filter.subgenre || g.subgenres.some((s) => s.subgenre === filter.subgenre))));
}

export interface SuggestionRow {
  tag: GenreTag;
  label: string;
  sourceLabel: string;
  percent: number;
}

/** What the sources said about a track, best first, in words: for the review screen and the genre sheet. */
export function suggestionRows(track: Pick<Track, "genreTags">): SuggestionRow[] {
  return suggestionsFrom(track.genreTags ?? []).map((tag) => ({
    tag,
    label: tag.subgenre ? `${tag.genre} · ${tag.subgenre}` : tag.genre,
    sourceLabel: SOURCE_LABELS[tag.source],
    percent: Math.round(tag.confidence * 100),
  }));
}

/** The tracks waiting for review, the ones with the surest best guess first (they are the quickest to accept). */
export function reviewQueue(tracks: readonly Track[]): Track[] {
  const best = (t: Track) => resolveGenreTags(t.genreTags).candidates[0]?.confidence ?? 0;
  return tracks.filter((t) => t.genreStatus === "needs-review").sort((a, b) => best(b) - best(a) || a.title.localeCompare(b.title));
}

/** The moods and genres of a track as short words for a chip row (genres first, then moods). */
export function genreChipLabels(track: Pick<Track, "genreTags" | "genre" | "subgenres" | "moods">): { genres: string[]; moods: string[] } {
  const genres: string[] = [];
  for (const g of genresOfTrack(track)) {
    genres.push(g.genre);
    for (const s of g.subgenres) genres.push(s.subgenre);
  }
  return { genres, moods: track.moods ?? [] };
}
