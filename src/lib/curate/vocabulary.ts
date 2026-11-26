/**
 * How people actually word a playlist request, and what each wording means in the app's own terms (canonical moods, an occasion). The local reader (spec.ts
 * parseRequestLocally) applies it before it looks for genres, so a phrase it knows is never misread as a genre ("high energy" is not the Hi-NRG subgenre, "mellow" is
 * not the Easy Listening genre, "romantic dinner" is not a classical period), and the model that reads requests (llmSpec.ts) is shown the same list.
 *
 * It covers the kinds of occasions and moods people file music under: pumping up, an evening wind-down, parties and barbecues, driving, sad and mellow, childhood
 * throwbacks, love songs and slow dances, plus the energy and mood words the taxonomy would otherwise misread. No song data and no personal playlist names are in here: it
 * is wording only. Pure.
 */
import type { ProfileId } from "@/lib/curate/profiles";

export interface VocabularyEntry {
  /** The wordings that mean it, lower case. A hyphenated and an unhyphenated form are separate phrases. The longest phrase that matches wins. */
  phrases: readonly string[];
  /** Canonical mood ids (lib/moodTags.ts). */
  moods: readonly string[];
  /** The occasion this points to, used only when the rest of the request names none (an occasion named in so many words wins). */
  profile?: ProfileId;
  /** Where the wording comes from, for whoever reads this file. */
  from: string;
  /** Leave the entry out when the request also matches this: a word that means something else next to these ("romantic" beside "composer"). */
  unless?: RegExp;
}

const CLASSICAL = /\b(classical|composers?|symphon\w*|piano|orchestra\w*|baroque|opera|chopin|liszt|schumann|brahms|romantic (?:era|period))\b/;

export const VOCABULARY: readonly VocabularyEntry[] = [
  { from: "pump-up wording", phrases: ["get pumped", "get me pumped", "get you pumped", "pump up", "pump me up", "pumped up", "psych up", "psyched up", "get hyped", "hype me up", "hype up", "fired up", "amp up", "adrenaline"], moods: ["energetic"] },
  { from: "evening wind-down wording", phrases: ["wine down", "vibes and wine down", "wine night", "glass of wine", "wine and chill", "after work", "after-work", "end of the day", "long day", "decompress", "de-stress", "destress"], moods: ["chill", "dinner"], profile: "chill" },
  { from: "party and barbecue wording", phrases: ["bbq", "barbecue", "bar-b-q", "cookout", "tailgate", "tailgating", "backyard", "pool party", "house party", "game day", "get together", "get-together", "pregame", "pre-game"], moods: ["party", "happy"], profile: "party" },
  { from: "car and driving wording", phrases: ["car tunes", "car ride", "car rides", "in the car", "for the car", "windows down", "cruising", "commute", "commuting", "long drive"], moods: ["road-trip"], profile: "road-trip" },
  { from: "night driving wording", phrases: ["night drive", "late night drive", "late-night drive"], moods: ["road-trip", "late-night"], profile: "road-trip" },
  { from: "sad and mellow wording", phrases: ["sad and mellow", "rainy day", "rainy days", "rainy night", "cry to", "crying", "feeling down", "feel down", "feeling sad", "feeling blue", "in my feelings", "heartache", "broken heart"], moods: ["sad", "chill"] },
  { from: "childhood and throwback wording", phrases: ["childhood", "growing up", "when i was a kid", "as a kid", "back in the day", "high school", "middle school"], moods: ["nostalgic", "happy"] },
  { from: "love and slow-dance wording", phrases: ["lovey dovey", "lovey-dovey", "slow dance", "slow dancing", "valentine", "valentines", "anniversary", "cuddle", "cuddling", "sweet nothings"], moods: ["romantic"] },
  { from: "slow morning wording", phrases: ["sunday morning", "lazy sunday", "lazy morning", "slow morning", "rainy morning", "coffee shop"], moods: ["chill"], profile: "chill" },
  // Wordings the taxonomy would misread as a genre, or read as the opposite of what they say.
  { from: "energy words", phrases: ["high energy", "high-energy", "full energy", "max energy"], moods: ["energetic"] },
  { from: "energy words", phrases: ["low energy", "low-energy", "low key", "low-key", "laid back", "laid-back", "easy going", "easygoing", "slow songs", "slow music", "something slow", "take it easy"], moods: ["chill"] },
  { from: "mood words", phrases: ["mellow", "mellow vibes"], moods: ["chill"] },
  { from: "mood words", phrases: ["romantic"], moods: ["romantic"], unless: CLASSICAL },
];

// Letters outside plain ASCII (U+00C0 to U+024F: accented Latin) are kept in a word; built from code points so the source holds no invisible characters.
const NOT_WORD = new RegExp(`[^a-z0-9&'${String.fromCharCode(0xc0)}-${String.fromCharCode(0x24f)}/+-]+`, "g");

/** Splits into words keeping "r&b", "hip-hop" and "lo-fi" whole (the reader and the vocabulary must split a request the same way). */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(NOT_WORD, " ").trim().split(/\s+/).filter(Boolean);
}

interface Candidate {
  tokens: string[];
  entry: VocabularyEntry;
  phrase: string;
}

const CANDIDATES: readonly Candidate[] = VOCABULARY.flatMap((entry) => entry.phrases.map((phrase) => ({ tokens: wordsOf(phrase), entry, phrase }))).sort((a, b) => b.tokens.length - a.tokens.length);

export interface VocabularyReading {
  /** Canonical moods the vocabulary found, in the order they were named. */
  moods: string[];
  /** The occasion the vocabulary points to, when it does. */
  profile: ProfileId | null;
  /** Which tokens of the request the vocabulary used, so the genre and mood reader leaves them alone. */
  used: boolean[];
  /** What was read as what, for a plain note to the person. */
  hits: { phrase: string; moods: string[] }[];
  /** The request with the vocabulary's own words taken out, for finding an occasion the person named in other words. */
  remainder: string;
}

/** Reads the vocabulary's wordings in a request. `tokens` is wordsOf(text); `text` is the request, lower case. */
export function readVocabulary(tokens: readonly string[], text: string): VocabularyReading {
  const used = new Array<boolean>(tokens.length).fill(false);
  const moods: string[] = [];
  const hits: { phrase: string; moods: string[] }[] = [];
  let profile: ProfileId | null = null;
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    for (const c of CANDIDATES) {
      if (i + c.tokens.length > tokens.length || c.tokens.length === 0) continue;
      if (c.tokens.some((t, k) => tokens[i + k] !== t || used[i + k])) continue;
      if (c.entry.unless?.test(text)) continue;
      for (let k = 0; k < c.tokens.length; k++) used[i + k] = true;
      for (const m of c.entry.moods) if (!moods.includes(m)) moods.push(m);
      if (!profile && c.entry.profile) profile = c.entry.profile;
      hits.push({ phrase: c.phrase, moods: [...c.entry.moods] });
      break;
    }
  }
  return { moods, profile, used, hits, remainder: tokens.filter((_, i) => !used[i]).join(" ") };
}

/** The vocabulary as lines for the model that reads requests, so it reads a phrase the way the local reader does. */
export function vocabularyPrompt(): string {
  return VOCABULARY.map((e) => `- ${e.phrases.map((p) => `"${p}"`).join(", ")} -> moods: ${e.moods.join(", ")}${e.profile ? `; occasion: ${e.profile}` : ""}${e.unless ? " (not when the request is about classical music)" : ""}`).join("\n");
}
