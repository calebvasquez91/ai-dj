// Pure, synchronous search/rank logic for the top search box — filters the
// already-loaded Zustand data (tracks, playlists, FX) on every keystroke with
// no network. Spotify/Apple-Music-style forgiving matching:
//   - case- and accent-insensitive ("bjork" finds "Björk")
//   - multi-word queries AND together (every word must match *something*)
//   - ranking: exact/prefix > whole-word/word-start > substring, with the
//     title weighted above artist above tags, genre, mood and year.
//   - typo tolerance: when a query finds few songs, words one or two letters off
//     ("bohemain", "dafft punk") match too, after the exact matches.
import type { FxSound, Playlist, Track } from "@/types/music";
import { genreHits, mergeHits } from "@/lib/genreSearch";
import { genresOfTrack } from "@/lib/genreLibrary";

/** Lowercases and strips diacritics. Output length can differ from the input's — see normalizeWithMap for position-preserving use. */
export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/**
 * Normalizes like normalizeText but also returns, for each output char, the
 * [start, end) range of the ORIGINAL string it came from — what lets match
 * highlighting land on the right characters when "é" -> "e" or "İ" -> "i̇"
 * changes the string's length.
 */
export function normalizeWithMap(text: string): { norm: string; starts: number[]; ends: number[] } {
  let norm = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of text) {
    const end = i + ch.length;
    const out = ch.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
    for (const c of out) {
      for (let k = 0; k < c.length; k++) {
        starts.push(i);
        ends.push(end);
      }
      norm += c;
    }
    i = end;
  }
  return { norm, starts, ends };
}

const MAX_TOKENS = 8;

/** Splits a raw query into normalized, de-duplicated words. Empty/whitespace-only queries give []. */
export function tokenizeQuery(query: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of normalizeText(query).split(/\s+/)) {
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    tokens.push(raw);
    if (tokens.length >= MAX_TOKENS) break;
  }
  return tokens;
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/** Match quality tiers, best first. Numbers are the base score a token earns against one field before field weighting. */
export const MATCH_SCORE = {
  exact: 100,
  prefix: 80,
  wordExact: 65,
  wordStart: 60,
  substring: 30,
  /** A word that is one or two letters off the typed one (a typo); always below a real match. */
  fuzzy: 22,
} as const;

/** The shortest typed word that is allowed to be a typo (a shorter one is too likely to be a different word). */
const FUZZY_MIN_LENGTH = 4;
/** A query that finds fewer songs than this also gets the typo matches. */
const FUZZY_BELOW_HITS = 6;

/** Letters that may be wrong: one for a short word, two for a long one. */
function allowedTypos(length: number): number {
  return length >= 7 ? 2 : 1;
}

/** Whether two strings are within `max` edits (insert, delete, replace, or swapping two neighbours). Stops early once it cannot be. */
export function withinEdits(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;
  const n = a.length;
  const m = b.length;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const row: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      row.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false;
    prev2 = prev;
    prev = row;
  }
  return prev[m] <= max;
}

/** The typo score of one (already-normalized) token against a normalized field: it matches a word of the field, or the start of one (a half-typed word with a typo), within the allowed edits. 0 when it does not. */
export function fuzzyScoreToken(field: string, token: string): number {
  if (token.length < FUZZY_MIN_LENGTH || !field) return 0;
  const max = allowedTypos(token.length);
  for (const word of field.split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    if (withinEdits(token, word, max) || (word.length > token.length && withinEdits(token, word.slice(0, token.length), max))) return MATCH_SCORE.fuzzy;
  }
  return 0;
}

/** Best base score of one (already-normalized) token against one (already-normalized) field, or 0 for no match. */
export function scoreToken(field: string, token: string): number {
  if (!token || !field) return 0;
  if (field === token) return MATCH_SCORE.exact;
  const first = field.indexOf(token);
  if (first === -1) return 0;
  if (first === 0) return MATCH_SCORE.prefix;
  let best: number = MATCH_SCORE.substring;
  for (let at = first; at !== -1; at = field.indexOf(token, at + 1)) {
    if (at === 0 || !isWordChar(field[at - 1])) {
      const endAt = at + token.length;
      const wholeWord = endAt >= field.length || !isWordChar(field[endAt]);
      best = Math.max(best, wholeWord ? MATCH_SCORE.wordExact : MATCH_SCORE.wordStart);
      if (best === MATCH_SCORE.wordExact) break;
    }
  }
  return best;
}

interface IndexedField {
  text: string;
  weight: number;
}

/** Bonus (before weighting) when a multi-word query matches a field as one contiguous phrase — "daft punk" should beat a row where "daft" and "punk" are in different fields. */
const PHRASE_PREFIX_BONUS = 40;
const PHRASE_SUBSTRING_BONUS = 15;

function scoreFields(fields: readonly IndexedField[], tokens: readonly string[], phrase: string, fuzzy = false): number {
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const f of fields) {
      let s = scoreToken(f.text, token);
      if (s === 0 && fuzzy) s = fuzzyScoreToken(f.text, token);
      if (s > 0) best = Math.max(best, s * f.weight);
    }
    if (best === 0) return 0; // AND semantics: every token must land somewhere
    total += best;
  }
  if (tokens.length > 1) {
    let phraseBonus = 0;
    for (const f of fields) {
      const at = f.text.indexOf(phrase);
      if (at === -1) continue;
      phraseBonus = Math.max(phraseBonus, (at === 0 ? PHRASE_PREFIX_BONUS : PHRASE_SUBSTRING_BONUS) * f.weight);
    }
    total += phraseBonus;
  }
  return total;
}

export interface SearchHit<T> {
  item: T;
  score: number;
  /** Index in the input array — stable tie-break and a handle back to the source list. */
  index: number;
}

/**
 * Builds a ranked searcher over items whose searchable text is described by
 * `getFields`. Normalized field text is cached per item object (WeakMap), so
 * a keystroke only pays for matching, not re-normalizing thousands of
 * strings. The cache assumes items are treated immutably (the Zustand store
 * always replaces an object when it changes) — a mutated-in-place item would
 * keep its old index entry.
 */
function createSearcher<T extends object>(getFields: (item: T) => { text: string; weight: number }[]) {
  const cache = new WeakMap<T, IndexedField[]>();
  const indexOf = (item: T): IndexedField[] => {
    let fields = cache.get(item);
    if (!fields) {
      fields = getFields(item)
        .map((f) => ({ text: normalizeText(f.text), weight: f.weight }))
        .filter((f) => f.text.length > 0);
      cache.set(item, fields);
    }
    return fields;
  };

  return function search(items: readonly T[], query: string, limit = Infinity): SearchHit<T>[] {
    const tokens = tokenizeQuery(query);
    if (tokens.length === 0) return [];
    const phrase = tokens.join(" ");
    const hits: (SearchHit<T> & { len: number })[] = [];
    const sortHits = (list: (SearchHit<T> & { len: number })[]) => list.sort((a, b) => b.score - a.score || a.len - b.len || a.index - b.index);
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const fields = indexOf(item);
      const score = scoreFields(fields, tokens, phrase);
      if (score > 0) hits.push({ item, score, index, len: fields[0]?.text.length ?? 0 });
    }
    // Best score first; among equals prefer the shorter primary field (a
    // closer-to-exact match), then keep the library's own order.
    sortHits(hits);
    // Too few matches: the query may have a typo. Add the songs whose words are a letter or two off, after every real match.
    if (hits.length < FUZZY_BELOW_HITS && tokens.some((t) => t.length >= FUZZY_MIN_LENGTH)) {
      const found = new Set(hits.map((h) => h.index));
      const near: (SearchHit<T> & { len: number })[] = [];
      for (let index = 0; index < items.length; index++) {
        if (found.has(index)) continue;
        const fields = indexOf(items[index]);
        const score = scoreFields(fields, tokens, phrase, true);
        if (score > 0) near.push({ item: items[index], score, index, len: fields[0]?.text.length ?? 0 });
      }
      hits.push(...sortHits(near));
    }
    const top = hits.length > limit ? hits.slice(0, limit) : hits;
    return top.map(({ item, score, index }) => ({ item, score, index }));
  };
}

const TITLE_WEIGHT = 1;
const ARTIST_WEIGHT = 0.6;
const TAG_WEIGHT = 0.5;
/** Genre, subgenre and mood: what the song is, below its name and artist. */
const KIND_WEIGHT = 0.4;
const YEAR_WEIGHT = 0.3;

/** Everything a song can be found by: title and artist first, then tags, its genres, subgenres and moods, and the year. (There is no album on a song here, so none is searched.) */
export const searchTracks = createSearcher<Track>((t) => [
  { text: t.title, weight: TITLE_WEIGHT },
  { text: t.artist, weight: ARTIST_WEIGHT },
  ...(t.tags ?? []).map((tag) => ({ text: tag, weight: TAG_WEIGHT })),
  ...genresOfTrack(t).flatMap((g) => [{ text: g.genre, weight: KIND_WEIGHT }, ...g.subgenres.map((s) => ({ text: s.subgenre, weight: KIND_WEIGHT }))]),
  ...(t.subgenres ?? []).map((s) => ({ text: s, weight: KIND_WEIGHT })),
  ...(t.moods ?? []).map((m) => ({ text: m, weight: KIND_WEIGHT })),
  ...(t.year != null ? [{ text: String(t.year), weight: YEAR_WEIGHT }] : []),
]);

/**
 * searchTracks plus the tracks the query's genre, mood or decade words pick out ("trap", "slow jams", "90s r&b": lib/genreSearch.ts),
 * after the direct matches. A query that names none of those gives exactly searchTracks' answer.
 */
export function searchTracksWithGenres(tracks: readonly Track[], query: string): SearchHit<Track>[] {
  const text = searchTracks(tracks, query);
  // A query of several words that is an artist's name ("daft punk") is a search for that artist, not for the genre one of its words happens to name.
  const tokens = tokenizeQuery(query);
  const phrase = tokens.join(" ");
  if (tokens.length > 1 && text.some((h) => normalizeText(h.item.artist).includes(phrase))) return text;
  return mergeHits(text, genreHits(tracks, query));
}

export const searchPlaylists = createSearcher<Playlist>((p) => [{ text: p.name, weight: TITLE_WEIGHT }]);

export const searchFx = createSearcher<FxSound>((fx) => [
  { text: fx.name, weight: TITLE_WEIGHT },
  ...fx.tags.map((tag) => ({ text: tag, weight: TAG_WEIGHT })),
]);

export type SearchGroupKind = "tracks" | "playlists" | "fx";

/** `hits` is the display-limited head of `all` (every match, ranked) — `all` lets "play these results" and "See all N" use the full set. */
export type SearchGroup =
  | { kind: "tracks"; hits: SearchHit<Track>[]; all: SearchHit<Track>[] }
  | { kind: "playlists"; hits: SearchHit<Playlist>[]; all: SearchHit<Playlist>[] }
  | { kind: "fx"; hits: SearchHit<FxSound>[]; all: SearchHit<FxSound>[] };

export interface SearchData {
  tracks: readonly Track[];
  playlists: readonly Playlist[];
  fx: readonly FxSound[];
}

export const DEFAULT_GROUP_LIMITS: Record<SearchGroupKind, number> = { tracks: 6, playlists: 3, fx: 3 };

const GROUP_TIE_ORDER: Record<SearchGroupKind, number> = { tracks: 0, playlists: 1, fx: 2 };

/**
 * Searches everything at once for the quick-results dropdown. Only non-empty
 * groups are returned, ordered by each group's best hit so the overall top
 * result is always the first row (ties: songs, playlists, FX). Each group's
 * `all` is the pre-limit match list, for "See all N songs".
 */
export function searchAll(
  data: SearchData,
  query: string,
  limits: Record<SearchGroupKind, number> = DEFAULT_GROUP_LIMITS
): SearchGroup[] {
  const tracks = searchTracksWithGenres(data.tracks, query);
  const playlists = searchPlaylists(data.playlists, query);
  const fx = searchFx(data.fx, query);
  const groups: SearchGroup[] = [];
  if (tracks.length) groups.push({ kind: "tracks", hits: tracks.slice(0, limits.tracks), all: tracks });
  if (playlists.length) groups.push({ kind: "playlists", hits: playlists.slice(0, limits.playlists), all: playlists });
  if (fx.length) groups.push({ kind: "fx", hits: fx.slice(0, limits.fx), all: fx });
  groups.sort(
    (a, b) => b.hits[0].score - a.hits[0].score || GROUP_TIE_ORDER[a.kind] - GROUP_TIE_ORDER[b.kind]
  );
  return groups;
}

/** How many completions the search page offers under the box. */
export const SUGGESTION_LIMIT = 5;

interface Candidate {
  text: string;
  norm: string;
  count: number;
}

const trackCandidateCache = new WeakMap<readonly Track[], Map<string, Candidate>>();

/** Every title, artist and tag of the songs as keyword candidates, by normalised text, counted by how many songs carry them. Cached per library array. */
function trackCandidates(tracks: readonly Track[]): Map<string, Candidate> {
  const cached = trackCandidateCache.get(tracks);
  if (cached) return cached;
  const map = new Map<string, Candidate>();
  const add = (text: string | undefined) => {
    const trimmed = text?.trim();
    if (!trimmed) return;
    const norm = normalizeText(trimmed);
    const seen = map.get(norm);
    if (seen) seen.count++;
    else map.set(norm, { text: trimmed, norm, count: 1 });
  };
  for (const t of tracks) {
    add(t.title);
    add(t.artist);
    t.tags?.forEach(add);
  }
  trackCandidateCache.set(tracks, map);
  return map;
}

/**
 * Keyword completions for a half-typed query, so the search box can finish the user's thought ("dau" -> "Daft Punk",
 * "Daughter"). The candidates are the words people search by: song titles, artists, tags, playlist and FX names. A
 * candidate completes the query when it starts with everything typed, or when it contains the earlier words whole and a
 * word that starts with the last one still being typed. The query itself is never offered back. Best first: starts-with
 * before contains, then the keyword that appears on more items, then the shorter one.
 */
export function suggestKeywords(data: SearchData, query: string, limit = SUGGESTION_LIMIT): string[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0 || limit <= 0) return [];
  const typed = tokens.join(" ");
  const last = tokens[tokens.length - 1];
  const earlier = tokens.slice(0, -1);

  // The song candidates (every title, artist and tag) are worked out once per library and kept, so a keystroke only pays for the small
  // playlist and FX lists and for matching, not for normalising thousands of strings again.
  const fromSongs = trackCandidates(data.tracks);
  const extra = new Map<string, Candidate>(); // playlist and FX names, a handful: counted on their own, then merged
  const add = (text: string | undefined) => {
    const trimmed = text?.trim();
    if (!trimmed) return;
    const norm = normalizeText(trimmed);
    const seen = extra.get(norm);
    if (seen) seen.count++;
    else extra.set(norm, { text: trimmed, norm, count: 1 });
  };
  for (const p of data.playlists) add(p.name);
  for (const f of data.fx) {
    add(f.name);
    f.tags.forEach(add);
  }
  function* everyCandidate(): Generator<Candidate> {
    for (const c of fromSongs.values()) {
      const more = extra.get(c.norm);
      yield more ? { ...c, count: c.count + more.count } : c; // a copy: the cached entry is never changed
    }
    for (const c of extra.values()) if (!fromSongs.has(c.norm)) yield c;
  }

  const ranked: { text: string; norm: string; count: number; startsWith: boolean }[] = [];
  for (const c of everyCandidate()) {
    if (c.norm === typed) continue;
    if (c.norm.startsWith(typed)) {
      ranked.push({ ...c, startsWith: true });
      continue;
    }
    const words = c.norm.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (earlier.every((w) => words.includes(w)) && words.some((w) => w.startsWith(last))) {
      ranked.push({ ...c, startsWith: false });
    }
  }
  ranked.sort(
    (a, b) =>
      Number(b.startsWith) - Number(a.startsWith) ||
      b.count - a.count ||
      a.norm.length - b.norm.length ||
      a.norm.localeCompare(b.norm)
  );
  return ranked.slice(0, limit).map((c) => c.text);
}

/** A contiguous span of the ORIGINAL text to emphasize: [start, end). */
export type HighlightRange = [number, number];

/**
 * Where the query's words land in `text`, as ranges into the original (not
 * normalized) string, merged and sorted. For each word the best occurrence is
 * used — a word-start occurrence if there is one, else the first substring —
 * matching what the ranking rewarded.
 */
export function highlightRanges(text: string, query: string): HighlightRange[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0 || !text) return [];
  const { norm, starts, ends } = normalizeWithMap(text);
  const spans: HighlightRange[] = [];
  for (const token of tokens) {
    let chosen = -1;
    for (let at = norm.indexOf(token); at !== -1; at = norm.indexOf(token, at + 1)) {
      if (chosen === -1) chosen = at;
      if (at === 0 || !isWordChar(norm[at - 1])) {
        chosen = at;
        break;
      }
    }
    if (chosen === -1) continue;
    spans.push([starts[chosen], ends[chosen + token.length - 1]]);
  }
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: HighlightRange[] = [];
  for (const s of spans) {
    const lastSpan = merged[merged.length - 1];
    if (lastSpan && s[0] <= lastSpan[1]) lastSpan[1] = Math.max(lastSpan[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  return merged;
}

/** Splits `text` into alternating plain/highlighted segments for rendering — keeps the React side free of index math. */
export function highlightSegments(text: string, query: string): { text: string; match: boolean }[] {
  const ranges = highlightRanges(text, query);
  if (ranges.length === 0) return [{ text, match: false }];
  const out: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const [s, e] of ranges) {
    if (s > cursor) out.push({ text: text.slice(cursor, s), match: false });
    out.push({ text: text.slice(s, e), match: true });
    cursor = e;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), match: false });
  return out;
}

/** Positions a fixed-position popup so it never leaves the viewport — pure so it's unit-testable. */
export interface PopupRect {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export function clampPopupToViewport(
  anchor: { left: number; right: number; bottom: number },
  viewport: { width: number; height: number },
  opts: { preferredWidth?: number; minWidth?: number; margin?: number; gap?: number; minHeight?: number } = {}
): PopupRect {
  const margin = opts.margin ?? 8;
  const gap = opts.gap ?? 6;
  const usableWidth = Math.max(0, viewport.width - margin * 2);
  const anchorWidth = anchor.right - anchor.left;
  const wanted = Math.max(opts.preferredWidth ?? anchorWidth, opts.minWidth ?? 0, anchorWidth);
  const width = Math.min(wanted, usableWidth);
  const left = Math.min(Math.max(anchor.left, margin), Math.max(margin, viewport.width - margin - width));
  const top = Math.min(anchor.bottom + gap, Math.max(0, viewport.height - (opts.minHeight ?? 120)));
  const maxHeight = Math.max(0, viewport.height - top - margin);
  return { left, top, width, maxHeight };
}
