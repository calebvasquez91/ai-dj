/**
 * Lyrical/thematic signal for transition compatibility scoring — never
 * lyrics *display*. Per the copyright constraint this was built under:
 * fetched lyrics text is reduced to a small internal fingerprint (a set of
 * frequent, meaningful words + matched mood keywords) and compared for
 * similarity; the raw text itself is never persisted or surfaced in the UI,
 * only the derived fingerprint (see serializeFingerprint/deserializeFingerprint,
 * used to cache just the fingerprint on the Track row).
 *
 * getLyricalFingerprint() looks lyrics up via LRCLIB (lrclib.net) — free,
 * no API key, no rate limit, permissive CORS (confirmed directly), so this
 * runs as a plain client-side fetch, same as audio-analysis.ts's own
 * client-side analysis. Chosen over Musixmatch (free tier discontinued
 * August 2025) and Genius (official API never returns lyrics text at all,
 * only metadata) — see the project conversation for the full tradeoff.
 * Honest caveat: LRCLIB's lyrics data is community-contributed with no
 * visible publisher licensing behind it, unlike a service like Musixmatch
 * — a real, if reduced, legal consideration given this only ever derives
 * an internal signal and never stores or displays the lyrics themselves.
 */

import { genreFamilies } from "@/data/styles";

export interface LyricalFingerprint {
  /** The most frequent non-stopword words in the lyrics, lowercased — a rough bag-of-words fingerprint, not the lyrics themselves. */
  words: Set<string>;
  /** Mood/theme keywords (drawn from the same vocabulary data/styles.ts already uses for genre mood tags) that showed up in the lyrics. */
  moodTags: Set<string>;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "at", "by", "for", "with", "about", "against",
  "between", "into", "through", "during", "before", "after", "above", "below", "to", "from", "up",
  "down", "in", "out", "on", "off", "over", "under", "again", "further", "then", "once", "is", "am",
  "are", "was", "were", "be", "been", "being", "have", "has", "had", "having", "do", "does", "did",
  "doing", "will", "would", "should", "can", "could", "i", "you", "he", "she", "it", "we", "they",
  "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their", "this", "that",
  "these", "those", "im", "youre", "dont", "aint", "yeah", "oh", "na", "la", "ooh",
]);

const MOOD_KEYWORDS = new Set(genreFamilies.flatMap((g) => g.moodKeywords));

const MAX_FINGERPRINT_WORDS = 40;

/**
 * Reduces raw lyrics (or any text) to a fingerprint: pure and synchronous,
 * so it's directly unit-testable without any network dependency. The
 * caller is responsible for never persisting or displaying the input text
 * itself — only the returned fingerprint should be kept.
 */
export function fingerprintFromText(rawText: string): LyricalFingerprint {
  const counts = new Map<string, number>();
  const tokens = rawText.toLowerCase().match(/[a-z']+/g) ?? [];
  for (const token of tokens) {
    if (token.length < 3 || STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const words = new Set(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_FINGERPRINT_WORDS)
      .map(([word]) => word)
  );
  const moodTags = new Set([...MOOD_KEYWORDS].filter((keyword) => rawText.toLowerCase().includes(keyword)));
  return { words, moodTags };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** 0-1 similarity between two fingerprints — word overlap and mood-tag overlap, averaged. */
export function lyricalSimilarity(a: LyricalFingerprint, b: LyricalFingerprint): number {
  return (jaccard(a.words, b.words) + jaccard(a.moodTags, b.moodTags)) / 2;
}

/** Plain-array shape of a fingerprint for crossing JSON boundaries (DB storage, the track API response) — Sets aren't directly JSON-serializable. */
export interface SerializedLyricalFingerprint {
  words: string[];
  moodTags: string[];
}

export function serializeFingerprint(fp: LyricalFingerprint): SerializedLyricalFingerprint {
  return { words: [...fp.words], moodTags: [...fp.moodTags] };
}

export function deserializeFingerprint(s: SerializedLyricalFingerprint): LyricalFingerprint {
  return { words: new Set(s.words), moodTags: new Set(s.moodTags) };
}

const LRCLIB_SEARCH_URL = "https://lrclib.net/api/search";
/** localAudio.ts's parseFileName() fallback for a title it couldn't split an artist out of — searching LRCLIB with this as a literal artist name would only ever return zero results. */
const UNKNOWN_ARTIST = "Unknown Artist";

interface LrclibResult {
  plainLyrics?: string | null;
  instrumental?: boolean;
}

/**
 * Looks up a track's lyrics by title/artist and reduces them to a
 * fingerprint — never returns or retains the lyrics text itself past this
 * function. Resolves null for a genuine "searched successfully, nothing
 * found" (no match, instrumental) — callers are expected to cache that
 * result permanently, same as a real fingerprint, so a track LRCLIB
 * doesn't have isn't re-queried forever. A network/parse failure *throws*
 * instead, precisely so callers can tell the difference and only retry
 * for that case, not treat a transient error as a permanent negative.
 */
export async function getLyricalFingerprint(
  title: string,
  artist: string
): Promise<LyricalFingerprint | null> {
  const params = new URLSearchParams({ track_name: title });
  if (artist && artist !== UNKNOWN_ARTIST) params.set("artist_name", artist);
  const res = await fetch(`${LRCLIB_SEARCH_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`LRCLIB search failed: ${res.status}`);
  const results = (await res.json()) as LrclibResult[];
  const match = results.find((r) => !r.instrumental && r.plainLyrics && r.plainLyrics.trim().length > 0);
  if (!match?.plainLyrics) return null;
  return fingerprintFromText(match.plainLyrics);
}
