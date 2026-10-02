// Pure, synchronous search/rank logic for the top search box — filters the
// already-loaded Zustand data (tracks, playlists, FX) on every keystroke with
// no network. Spotify/Apple-Music-style forgiving matching:
//   - case- and accent-insensitive ("bjork" finds "Björk")
//   - multi-word queries AND together (every word must match *something*)
//   - ranking: exact/prefix > whole-word/word-start > substring, with the
//     title weighted above artist above tags.
import type { FxSound, Playlist, Track } from "@/types/music";

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
} as const;

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

function scoreFields(fields: readonly IndexedField[], tokens: readonly string[], phrase: string): number {
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const f of fields) {
      const s = scoreToken(f.text, token);
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
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const fields = indexOf(item);
      const score = scoreFields(fields, tokens, phrase);
      if (score > 0) hits.push({ item, score, index, len: fields[0]?.text.length ?? 0 });
    }
    // Best score first; among equals prefer the shorter primary field (a
    // closer-to-exact match), then keep the library's own order.
    hits.sort((a, b) => b.score - a.score || a.len - b.len || a.index - b.index);
    const top = hits.length > limit ? hits.slice(0, limit) : hits;
    return top.map(({ item, score, index }) => ({ item, score, index }));
  };
}

const TITLE_WEIGHT = 1;
const ARTIST_WEIGHT = 0.6;
const TAG_WEIGHT = 0.5;

export const searchTracks = createSearcher<Track>((t) => [
  { text: t.title, weight: TITLE_WEIGHT },
  { text: t.artist, weight: ARTIST_WEIGHT },
  ...(t.tags ?? []).map((tag) => ({ text: tag, weight: TAG_WEIGHT })),
]);

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
  const tracks = searchTracks(data.tracks, query);
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
