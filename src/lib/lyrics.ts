/**
 * Lyrical/thematic signal for transition compatibility scoring — never
 * lyrics *display*. Per the copyright constraint this was built under:
 * any fetched lyrics text is reduced to a small internal fingerprint
 * (a set of frequent, meaningful words + matched mood keywords) and
 * compared for similarity; the raw text itself is never stored here or
 * surfaced in the UI.
 *
 * getLyricalFingerprint() is currently an unconfigured stub — it always
 * resolves null. Wiring it to a real provider needs an actual lyrics-API
 * account/key (a server-side call, never a direct browser fetch — both to
 * keep the key secret and because most lyrics APIs don't send CORS headers
 * for browser use), which wasn't available when this was built. Everything
 * else here (the fingerprint math, the similarity score, and its use in
 * track-sequencing.ts) is real and already wired up — a null fingerprint
 * on either side just contributes nothing to the compatibility score
 * rather than being treated as a mismatch.
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

/**
 * Fetches (server-side, once a provider is configured) and fingerprints a
 * track's lyrics by title/artist. Always resolves null today — see the
 * module comment above for what's missing to activate this.
 */
export async function getLyricalFingerprint(
  title: string,
  artist: string
): Promise<LyricalFingerprint | null> {
  void title;
  void artist;
  return null;
}
