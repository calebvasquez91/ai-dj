/**
 * The mood words a track can carry next to its genres (Track.moods), and the function that collapses a messy mood tag onto
 * them. These are free descriptive labels from the genre sources (Last.fm tags, the LLM), not the four Home-screen mixes in
 * lib/moods.ts, which are worked out from tempo and loudness; the two meet only where a mood here also names a mix.
 */
import { aliasKey } from "@/lib/genres";

export interface MoodDef {
  id: string;
  aliases: string[];
}

export const MOOD_DEFS: readonly MoodDef[] = [
  { id: "chill", aliases: ["chillout", "chill out", "relax", "relaxing", "relaxed", "calm", "calming", "mellow", "laid back", "laidback", "easy", "soothing", "peaceful", "smooth", "lazy"] },
  { id: "energetic", aliases: ["energy", "energize", "energizing", "hype", "high energy", "pumped", "upbeat", "lively", "powerful", "intense"] },
  { id: "party", aliases: ["club", "clubbing", "dance floor", "dancefloor", "dancing", "danceable", "fun", "turn up", "banger", "bangers", "festival"] },
  { id: "workout", aliases: ["gym", "run", "running", "exercise", "fitness", "training", "cardio", "motivation", "motivational", "workout music"] },
  { id: "romantic", aliases: ["love", "love songs", "love song", "romance", "sensual", "sexy", "slow jam", "slow jams", "makeout", "date night", "wedding"] },
  { id: "sad", aliases: ["melancholy", "melancholic", "sadness", "heartbreak", "heartbroken", "breakup", "depressing", "emotional", "tearjerker", "lonely", "blue"] },
  { id: "happy", aliases: ["happiness", "cheerful", "feel good", "feelgood", "joyful", "joy", "positive", "sunny", "good vibes", "fun upbeat", "bright"] },
  { id: "dark", aliases: ["moody", "brooding", "gloomy", "eerie", "haunting", "ominous", "gothic", "sinister", "spooky vibes"] },
  { id: "dreamy", aliases: ["dream", "ethereal", "atmospheric", "floating", "hazy", "lush", "spacey", "airy", "trippy"] },
  { id: "aggressive", aliases: ["angry", "anger", "rage", "hard", "heavy", "brutal", "fierce", "raw"] },
  { id: "uplifting", aliases: ["inspiring", "inspirational", "hopeful", "anthemic", "triumphant", "empowering", "euphoric", "feel good anthem"] },
  { id: "nostalgic", aliases: ["nostalgia", "throwback", "throwbacks", "retro vibes", "memories", "old school vibes", "sentimental"] },
  { id: "focus", aliases: ["study", "studying", "concentration", "work", "working", "background", "productivity", "reading"] },
  { id: "sleep", aliases: ["sleepy", "bedtime", "lullaby vibes", "night", "drowsy", "sleeping"] },
  { id: "summer", aliases: ["beach", "sunshine", "summertime", "pool party", "vacation", "tropical vibes", "road trip summer"] },
  { id: "late-night", aliases: ["late night", "after hours", "afterhours", "midnight", "nocturnal", "night drive", "night time", "nighttime", "2am"] },
  { id: "road-trip", aliases: ["road trip", "driving", "drive", "car", "cruising", "highway", "travel"] },
  { id: "dinner", aliases: ["dinner party", "cocktail hour", "brunch", "background dinner", "dining", "dinner music"] },
];

const LOOKUP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const m of MOOD_DEFS) {
    map.set(aliasKey(m.id), m.id);
    for (const a of m.aliases) if (!map.has(aliasKey(a))) map.set(aliasKey(a), m.id);
  }
  return map;
})();

/** The canonical mood a tag names, or null when it names none (a genre, a year, "seen live"). */
export function normalizeMood(rawTag: string | null | undefined): string | null {
  if (typeof rawTag !== "string") return null;
  const key = aliasKey(rawTag);
  if (!key || key.length > 40) return null;
  return LOOKUP.get(key) ?? null;
}

/** Whether a stored mood is one of the canonical ids. */
export function isMoodId(id: string): boolean {
  return MOOD_DEFS.some((m) => m.id === id);
}

export function moodIds(): string[] {
  return MOOD_DEFS.map((m) => m.id);
}
