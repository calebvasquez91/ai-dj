/**
 * The "Add Music" bar at the bottom of every playlist: which tracks of the user's own library to offer, in what order.
 * Pure, so the rules can be tested; AddMusicBar.tsx does the typing, the debounce and the adding.
 *
 * Matches title, artist, tags (the nearest thing to a genre this library has) and the track's BPM and key, any case and
 * accent, partial words allowed, every typed word having to land somewhere. Tracks already in the playlist are left out.
 * In Spooky Music the Halloween-tagged tracks come first. With nothing typed it offers the most recently added tracks.
 */

import type { Track } from "@/types/music";
import { normalizeText, scoreToken, tokenizeQuery } from "@/lib/search";
import { hasSpookyTrackTag } from "@/lib/spookyTags";

/** How many tracks the empty-query "Recently added to library" list shows. */
export const RECENT_LIMIT = 10;
/** How many matches a typed query returns at most (the dropdown shows six at a time and scrolls). */
export const RESULT_LIMIT = 30;

/** What the search knows about a track beyond the track itself: its analysed tempo and key, when there is one. */
export interface TrackFacts {
  bpm: number | null;
  key: string | null;
}

export interface AddMusicResult {
  track: Track;
  bpm: number | null;
  key: string | null;
  /** True for a Spooky-tagged track (what Spooky Music lists first). */
  spooky: boolean;
}

export interface AddMusicQuery {
  library: readonly Track[];
  /** Ids already in the playlist: never offered, except those in `keepIds` (just added, still showing their check). */
  playlistTrackIds: ReadonlySet<string>;
  keepIds?: ReadonlySet<string>;
  /** Tempo and key per track (the player's analysis, falling back to the track's own bpm). */
  facts: (track: Track) => TrackFacts;
  query: string;
  /** The playlist being added to is Spooky Music. */
  spookyPlaylist: boolean;
}

const WEIGHTS = { title: 1, artist: 0.6, tag: 0.5, bpm: 0.5, key: 0.5 };

function score(track: Track, facts: TrackFacts, tokens: readonly string[]): number {
  const fields: { text: string; weight: number }[] = [
    { text: normalizeText(track.title), weight: WEIGHTS.title },
    { text: normalizeText(track.artist), weight: WEIGHTS.artist },
    ...(track.tags ?? []).map((tag) => ({ text: normalizeText(tag), weight: WEIGHTS.tag })),
  ];
  if (facts.bpm != null && facts.bpm > 0) fields.push({ text: String(Math.round(facts.bpm)), weight: WEIGHTS.bpm });
  if (facts.key) fields.push({ text: normalizeText(facts.key), weight: WEIGHTS.key });

  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const f of fields) {
      const s = scoreToken(f.text, token);
      if (s > 0) best = Math.max(best, s * f.weight);
    }
    if (best === 0) return 0; // every word has to land somewhere
    total += best;
  }
  return total;
}

export function searchForAddMusic({ library, playlistTrackIds, keepIds, facts, query, spookyPlaylist }: AddMusicQuery): AddMusicResult[] {
  const candidates = library.filter((t) => !playlistTrackIds.has(t.id) || keepIds?.has(t.id));
  const tokens = tokenizeQuery(query);

  let ranked: { track: Track; score: number; index: number }[];
  if (tokens.length === 0) {
    ranked = candidates
      .map((track, index) => ({ track, score: 0, index }))
      .sort((a, b) => b.track.addedAt - a.track.addedAt || a.index - b.index)
      .slice(0, RECENT_LIMIT);
  } else {
    ranked = candidates
      .map((track, index) => ({ track, score: score(track, facts(track), tokens), index }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, RESULT_LIMIT);
  }

  const results = ranked.map(({ track }): AddMusicResult => {
    const f = facts(track);
    return { track, bpm: f.bpm, key: f.key, spooky: hasSpookyTrackTag(track.tags) };
  });
  // Spooky Music: its own kind of track first, each group keeping its order (Array.prototype.sort is stable).
  return spookyPlaylist ? [...results].sort((a, b) => Number(b.spooky) - Number(a.spooky)) : results;
}
